#!/bin/sh
set -eu

: "${GCP_PROJECT_ID:?GCP_PROJECT_ID is required}"
: "${GCP_REGION:?GCP_REGION is required}"
: "${PHASE_C1_PREVIEW_CONFIRMATION:?PHASE_C1_PREVIEW_CONFIRMATION is required}"
: "${WORKER_SERVICE_ACCOUNT:?WORKER_SERVICE_ACCOUNT is required}"
: "${WORKER_IMAGE_DIGEST:?WORKER_IMAGE_DIGEST is required}"
: "${WORKER_DEPLOYMENT_ID:?WORKER_DEPLOYMENT_ID is required}"
: "${WORKER_ID:?WORKER_ID is required}"
: "${WORKER_KEY_VERSION:?WORKER_KEY_VERSION is required}"
: "${WORKER_SECRET_VERSION:?WORKER_SECRET_VERSION is required}"
: "${NVIDIA_SECRET_VERSION:?NVIDIA_SECRET_VERSION is required}"
: "${BROKER_URL:?BROKER_URL is required}"
: "${BROKER_AUDIENCE:?BROKER_AUDIENCE is required}"

WORKER_POOL="${WORKER_POOL:-vaeroex-document-extraction-preview}"
WORKER_SECRET_NAME="${WORKER_SECRET_NAME:-vaeroex-document-worker-preview-ed25519}"
NVIDIA_SECRET_NAME="${NVIDIA_SECRET_NAME:-vaeroex-document-worker-preview-nvidia}"

if [ "$PHASE_C1_PREVIEW_CONFIRMATION" != "vaeroex-document-extraction-phase-c1-preview-only" ]; then
  printf '%s\n' "Preview deployment confirmation did not match." >&2
  exit 2
fi
if [ "$GCP_PROJECT_ID" != "vaeroex-document-worker" ] || [ "$GCP_REGION" != "us-west1" ]; then
  printf '%s\n' "Only the isolated Phase C1 Google project and region are accepted." >&2
  exit 2
fi
if [ "$WORKER_POOL" != "vaeroex-document-extraction-preview" ] \
  || [ "$WORKER_SERVICE_ACCOUNT" != "vaeroex-doc-worker-preview@$GCP_PROJECT_ID.iam.gserviceaccount.com" ] \
  || [ "$WORKER_SECRET_NAME" != "vaeroex-document-worker-preview-ed25519" ] \
  || [ "$NVIDIA_SECRET_NAME" != "vaeroex-document-worker-preview-nvidia" ]; then
  printf '%s\n' "The worker deployment target is outside the approved Preview scope." >&2
  exit 2
fi

case "$WORKER_IMAGE_DIGEST" in
  "$GCP_REGION-docker.pkg.dev/$GCP_PROJECT_ID/vaeroex-document-workers-preview/document-extraction-worker"@sha256:????????????????????????????????????????????????????????????????) ;;
  *) printf '%s\n' "WORKER_IMAGE_DIGEST must be immutable." >&2; exit 2 ;;
esac

script_directory="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
worker_root="$(dirname "$script_directory")"
rendered_manifest="$(mktemp "${TMPDIR:-/tmp}/vaeroex-worker-pool.XXXXXX")"
deployed_description="$(mktemp "${TMPDIR:-/tmp}/vaeroex-worker-pool-description.XXXXXX")"
trap 'rm -f "$rendered_manifest" "$deployed_description"' EXIT HUP INT TERM

python3 "$script_directory/render-worker-pool.py" \
  --template "$worker_root/cloud-run-worker-pool.yaml.template" \
  --output "$rendered_manifest" \
  --worker-pool "$WORKER_POOL" \
  --service-account "$WORKER_SERVICE_ACCOUNT" \
  --image-digest "$WORKER_IMAGE_DIGEST" \
  --deployment-id "$WORKER_DEPLOYMENT_ID" \
  --worker-id "$WORKER_ID" \
  --worker-key-version "$WORKER_KEY_VERSION" \
  --broker-url "$BROKER_URL" \
  --broker-audience "$BROKER_AUDIENCE" \
  --worker-secret-name "$WORKER_SECRET_NAME" \
  --worker-secret-version "$WORKER_SECRET_VERSION" \
  --nvidia-secret-name "$NVIDIA_SECRET_NAME" \
  --nvidia-secret-version "$NVIDIA_SECRET_VERSION"

CLOUDSDK_RUN_REGION="$GCP_REGION" gcloud run worker-pools replace "$rendered_manifest" \
  --project "$GCP_PROJECT_ID" \
  --quiet >/dev/null

gcloud run worker-pools describe "$WORKER_POOL" \
  --project "$GCP_PROJECT_ID" \
  --region "$GCP_REGION" \
  --format json >"$deployed_description"

python3 "$script_directory/verify-worker-pool.py" \
  --description-file "$deployed_description" \
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
  --expected-instances 0 \
  --expected-gate-state disabled >/dev/null

printf '%s\n' "Preview worker revision deployed inert at zero instances."
