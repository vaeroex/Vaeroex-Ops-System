#!/bin/sh
set -eu

: "${GCP_PROJECT_ID:?GCP_PROJECT_ID is required}"
: "${GCP_PROJECT_NUMBER:?GCP_PROJECT_NUMBER is required}"
: "${GCP_REGION:?GCP_REGION is required}"
: "${GOOGLE_DOCUMENT_AI_PROCESSOR_ID:?GOOGLE_DOCUMENT_AI_PROCESSOR_ID is required}"
: "${BROKER_SERVICE:?BROKER_SERVICE is required}"
: "${BROKER_IMAGE_DIGEST:?BROKER_IMAGE_DIGEST is required}"
: "${BROKER_SERVICE_ACCOUNT:?BROKER_SERVICE_ACCOUNT is required}"
: "${WORKER_SERVICE_ACCOUNT:?WORKER_SERVICE_ACCOUNT is required}"
: "${PREVIEW_SUPABASE_URL:?PREVIEW_SUPABASE_URL is required}"
: "${SUPABASE_SECRET_VERSION:?SUPABASE_SECRET_VERSION is required}"
: "${WORKER_KEYS_SECRET_VERSION:?WORKER_KEYS_SECRET_VERSION is required}"
: "${CAPABILITY_KEYS_SECRET_VERSION:?CAPABILITY_KEYS_SECRET_VERSION is required}"
: "${TELEMETRY_SECRET_VERSION:?TELEMETRY_SECRET_VERSION is required}"
: "${ENCRYPTION_KEYS_SECRET_VERSION:?ENCRYPTION_KEYS_SECRET_VERSION is required}"
: "${PHASE_C1_PREVIEW_CONFIRMATION:?PHASE_C1_PREVIEW_CONFIRMATION is required}"

if [ "$PHASE_C1_PREVIEW_CONFIRMATION" != "vaeroex-document-extraction-phase-c1-preview-only" ]; then
  printf '%s\n' "Preview broker confirmation did not match." >&2
  exit 2
fi
if [ "$GCP_PROJECT_ID" != "vaeroex-document-worker" ] \
  || [ "$GCP_PROJECT_NUMBER" != "626856681952" ] \
  || [ "$GCP_REGION" != "us-west1" ]; then
  printf '%s\n' "Only the isolated Phase C1 Google project and region are accepted." >&2
  exit 2
fi

case "$BROKER_SERVICE" in
  vaeroex-doc-broker-pr265-???????|vaeroex-doc-broker-pr265-????????|vaeroex-doc-broker-pr265-????????????) ;;
  *) printf '%s\n' "BROKER_SERVICE must be bound to the PR #265 commit." >&2; exit 2 ;;
esac
case "$BROKER_IMAGE_DIGEST" in
  "$GCP_REGION-docker.pkg.dev/$GCP_PROJECT_ID/vaeroex-document-workers-preview/document-extraction-broker"@sha256:????????????????????????????????????????????????????????????????) ;;
  *) printf '%s\n' "BROKER_IMAGE_DIGEST must be immutable." >&2; exit 2 ;;
esac
case "$PREVIEW_SUPABASE_URL" in
  https://zfpnhvcmuuvtswttmnjd.supabase.co) ;;
  *) printf '%s\n' "Only the isolated Preview Supabase project is accepted." >&2; exit 2 ;;
esac
case "$GOOGLE_DOCUMENT_AI_PROCESSOR_ID" in
  [0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]) ;;
  *) printf '%s\n' "The Google processor ID is malformed." >&2; exit 2 ;;
esac
commit_suffix="${BROKER_SERVICE#vaeroex-doc-broker-pr265-}"
if [ "$BROKER_SERVICE_ACCOUNT" != "vx-doc-broker-$commit_suffix@$GCP_PROJECT_ID.iam.gserviceaccount.com" ]; then
  printf '%s\n' "BROKER_SERVICE_ACCOUNT must match the PR-bound broker." >&2
  exit 2
fi
if [ "$WORKER_SERVICE_ACCOUNT" != "vaeroex-doc-worker-preview@$GCP_PROJECT_ID.iam.gserviceaccount.com" ]; then
  printf '%s\n' "WORKER_SERVICE_ACCOUNT must be the isolated Preview worker." >&2
  exit 2
fi

for version in \
  "$SUPABASE_SECRET_VERSION" \
  "$WORKER_KEYS_SECRET_VERSION" \
  "$CAPABILITY_KEYS_SECRET_VERSION" \
  "$TELEMETRY_SECRET_VERSION" \
  "$ENCRYPTION_KEYS_SECRET_VERSION"
do
  case "$version" in
    ''|*[!0-9]*|0) printf '%s\n' "Every broker secret version must be an exact positive integer." >&2; exit 2 ;;
  esac
done

SUPABASE_SECRET_NAME="$BROKER_SERVICE-supabase-service-role"
WORKER_KEYS_SECRET_NAME="$BROKER_SERVICE-worker-public-keys"
CAPABILITY_KEYS_SECRET_NAME="$BROKER_SERVICE-capability-keys"
TELEMETRY_SECRET_NAME="$BROKER_SERVICE-telemetry-hmac"
ENCRYPTION_KEYS_SECRET_NAME="$BROKER_SERVICE-encryption-keys"

gcloud run deploy "$BROKER_SERVICE" \
  --project "$GCP_PROJECT_ID" \
  --region "$GCP_REGION" \
  --platform managed \
  --image "$BROKER_IMAGE_DIGEST" \
  --service-account "$BROKER_SERVICE_ACCOUNT" \
  --no-allow-unauthenticated \
  --ingress all \
  --min 0 \
  --max 1 \
  --concurrency 1 \
  --cpu 1 \
  --memory 512Mi \
  --timeout 60 \
  --execution-environment gen2 \
  --labels "vaeroex-phase=phase-c1,vaeroex-pr=265,vaeroex-environment=preview,vaeroex-provider=google-document-ai" \
  --set-env-vars "DOCUMENT_EXTRACTION_BROKER_RUNTIME_ENVIRONMENT=preview,DOCUMENT_EXTRACTION_PRIVATE_WORKER_ENABLED=false,DOCUMENT_EXTRACTION_PROVIDER_EXECUTION_ENABLED=false,DOCUMENT_EXTRACTION_SYNTHETIC_QUALIFICATION_ENABLED=false,DOCUMENT_EXTRACTION_SYNTHETIC_PROVIDER_CALLS_ENABLED=false,DOCUMENT_EXTRACTION_GOOGLE_FROZEN_CONTROLLER_ENABLED=false,DOCUMENT_EXTRACTION_ACTIVE_PROVIDER_PROFILE=google_document_ai_enterprise_ocr_v1,DOCUMENT_EXTRACTION_GOOGLE_PROJECT_NUMBER=$GCP_PROJECT_NUMBER,DOCUMENT_EXTRACTION_GOOGLE_PROCESSOR_ID=$GOOGLE_DOCUMENT_AI_PROCESSOR_ID,DOCUMENT_EXTRACTION_GOOGLE_LOCATION=us,DOCUMENT_EXTRACTION_GOOGLE_PROCESSOR_VERSION=pretrained-ocr-v2.1-2024-08-07,DOCUMENT_EXTRACTION_GOOGLE_MODEL=pretrained-ocr-v2.1-2024-08-07,DOCUMENT_EXTRACTION_GOOGLE_CLIENT_REVISION=vaeroex_google_document_ai_rest_v1,DOCUMENT_EXTRACTION_GOOGLE_PARSER_REVISION=google_document_ai_enterprise_ocr_v1,DOCUMENT_EXTRACTION_BROKER_CAPABILITY_CURRENT_KEY_VERSION=broker-capability-pr265-v1,DOCUMENT_EXTRACTION_ENCRYPTION_CURRENT_KEY_VERSION=cache-encryption-pr265-v1,NEXT_PUBLIC_SUPABASE_URL=$PREVIEW_SUPABASE_URL" \
  --set-secrets "SUPABASE_SERVICE_ROLE_KEY=$SUPABASE_SECRET_NAME:$SUPABASE_SECRET_VERSION,DOCUMENT_EXTRACTION_WORKER_PUBLIC_KEYS_JSON=$WORKER_KEYS_SECRET_NAME:$WORKER_KEYS_SECRET_VERSION,DOCUMENT_EXTRACTION_BROKER_CAPABILITY_KEYS_JSON=$CAPABILITY_KEYS_SECRET_NAME:$CAPABILITY_KEYS_SECRET_VERSION,DOCUMENT_EXTRACTION_TELEMETRY_HMAC_SECRET=$TELEMETRY_SECRET_NAME:$TELEMETRY_SECRET_VERSION,DOCUMENT_EXTRACTION_ENCRYPTION_KEYS_JSON=$ENCRYPTION_KEYS_SECRET_NAME:$ENCRYPTION_KEYS_SECRET_VERSION" \
  --quiet >/dev/null

gcloud run services add-iam-policy-binding "$BROKER_SERVICE" \
  --project "$GCP_PROJECT_ID" \
  --region "$GCP_REGION" \
  --member "serviceAccount:$WORKER_SERVICE_ACCOUNT" \
  --role roles/run.invoker \
  --condition=None \
  --quiet >/dev/null

printf '%s\n' "Ephemeral Google Document AI Preview broker deployed inert with exact service-level invocation."
