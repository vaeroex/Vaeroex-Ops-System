#!/bin/sh
set -eu

: "${GCP_PROJECT_ID:?GCP_PROJECT_ID is required}"
: "${GCP_REGION:?GCP_REGION is required}"
: "${WORKER_SERVICE_ACCOUNT:?WORKER_SERVICE_ACCOUNT is required}"
: "${WORKER_IMAGE_DIGEST:?WORKER_IMAGE_DIGEST is required}"
: "${WORKER_DEPLOYMENT_ID:?WORKER_DEPLOYMENT_ID is required}"
: "${WORKER_ID:?WORKER_ID is required}"
: "${WORKER_KEY_VERSION:?WORKER_KEY_VERSION is required}"
: "${BROKER_URL:?BROKER_URL is required}"
: "${WORKER_SECRET_VERSION:?WORKER_SECRET_VERSION is required}"
: "${NVIDIA_SECRET_VERSION:?NVIDIA_SECRET_VERSION is required}"
: "${EXPECTED_INSTANCES:?EXPECTED_INSTANCES is required}"
: "${EXPECTED_GATE_STATE:?EXPECTED_GATE_STATE is required}"

WORKER_POOL="${WORKER_POOL:-vaeroex-document-extraction-preview}"
WORKER_SECRET_NAME="${WORKER_SECRET_NAME:-vaeroex-document-worker-preview-ed25519}"
NVIDIA_SECRET_NAME="${NVIDIA_SECRET_NAME:-vaeroex-document-worker-preview-nvidia}"
if [ "$GCP_PROJECT_ID" != "vaeroex-document-worker" ] || [ "$GCP_REGION" != "us-west1" ] \
  || [ "$WORKER_POOL" != "vaeroex-document-extraction-preview" ] \
  || [ "$WORKER_SERVICE_ACCOUNT" != "vaeroex-doc-worker-preview@$GCP_PROJECT_ID.iam.gserviceaccount.com" ]; then
  printf '%s\n' "Only the isolated Preview worker may be verified by this script." >&2
  exit 2
fi
script_directory="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
description="$(mktemp "${TMPDIR:-/tmp}/vaeroex-worker-description.XXXXXX")"
trap 'rm -f "$description"' EXIT HUP INT TERM
chmod 600 "$description"

gcloud run worker-pools describe "$WORKER_POOL" \
  --project "$GCP_PROJECT_ID" \
  --region "$GCP_REGION" \
  --format json >"$description"

python3 "$script_directory/verify-worker-pool.py" \
  --description-file "$description" \
  --worker-pool "$WORKER_POOL" \
  --service-account "$WORKER_SERVICE_ACCOUNT" \
  --image-digest "$WORKER_IMAGE_DIGEST" \
  --deployment-id "$WORKER_DEPLOYMENT_ID" \
  --worker-id "$WORKER_ID" \
  --worker-key-version "$WORKER_KEY_VERSION" \
  --broker-url "$BROKER_URL" \
  --worker-secret-name "$WORKER_SECRET_NAME" \
  --worker-secret-version "$WORKER_SECRET_VERSION" \
  --nvidia-secret-name "$NVIDIA_SECRET_NAME" \
  --nvidia-secret-version "$NVIDIA_SECRET_VERSION" \
  --expected-instances "$EXPECTED_INSTANCES" \
  --expected-gate-state "$EXPECTED_GATE_STATE"
