#!/bin/sh
set -eu

: "${GCP_PROJECT_ID:?GCP_PROJECT_ID is required}"
: "${PHASE_C1_PREVIEW_CONFIRMATION:?PHASE_C1_PREVIEW_CONFIRMATION is required}"
: "${WORKER_PRIVATE_KEY_FILE:?WORKER_PRIVATE_KEY_FILE is required}"
: "${NVIDIA_API_KEY_FILE:?NVIDIA_API_KEY_FILE is required}"
: "${WORKER_SERVICE_ACCOUNT:?WORKER_SERVICE_ACCOUNT is required}"

WORKER_SECRET_NAME="${WORKER_SECRET_NAME:-vaeroex-document-worker-preview-ed25519}"
NVIDIA_SECRET_NAME="${NVIDIA_SECRET_NAME:-vaeroex-document-worker-preview-nvidia}"
script_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"

if [ "$PHASE_C1_PREVIEW_CONFIRMATION" != "vaeroex-document-extraction-phase-c1-preview-only" ]; then
  printf '%s\n' "Preview secret-provisioning confirmation did not match." >&2
  exit 2
fi

python3 "$script_dir/verify-secret-files.py" \
  "$WORKER_PRIVATE_KEY_FILE" \
  "$NVIDIA_API_KEY_FILE"

for secret_name in "$WORKER_SECRET_NAME" "$NVIDIA_SECRET_NAME"; do
  if ! gcloud secrets describe "$secret_name" --project "$GCP_PROJECT_ID" >/dev/null 2>&1; then
    gcloud secrets create "$secret_name" \
      --project "$GCP_PROJECT_ID" \
      --replication-policy automatic >/dev/null
  fi
done

worker_version="$(gcloud secrets versions add "$WORKER_SECRET_NAME" \
  --project "$GCP_PROJECT_ID" \
  --data-file "$WORKER_PRIVATE_KEY_FILE" \
  --format 'value(name)')"
nvidia_version="$(gcloud secrets versions add "$NVIDIA_SECRET_NAME" \
  --project "$GCP_PROJECT_ID" \
  --data-file "$NVIDIA_API_KEY_FILE" \
  --format 'value(name)')"

for secret_name in "$WORKER_SECRET_NAME" "$NVIDIA_SECRET_NAME"; do
  gcloud secrets add-iam-policy-binding "$secret_name" \
    --project "$GCP_PROJECT_ID" \
    --member "serviceAccount:$WORKER_SERVICE_ACCOUNT" \
    --role roles/secretmanager.secretAccessor >/dev/null
done

printf '%s\n' "Preview worker secret versions provisioned without readback."
printf 'WORKER_SECRET_VERSION=%s\n' "${worker_version##*/}"
printf 'NVIDIA_SECRET_VERSION=%s\n' "${nvidia_version##*/}"
