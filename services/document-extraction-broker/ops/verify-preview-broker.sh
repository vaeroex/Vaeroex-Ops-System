#!/bin/sh
set -eu

: "${GCP_PROJECT_ID:?GCP_PROJECT_ID is required}"
: "${GCP_REGION:?GCP_REGION is required}"
: "${BROKER_SERVICE:?BROKER_SERVICE is required}"
: "${BROKER_SERVICE_ACCOUNT:?BROKER_SERVICE_ACCOUNT is required}"
: "${WORKER_SERVICE_ACCOUNT:?WORKER_SERVICE_ACCOUNT is required}"
: "${BROKER_IMAGE_DIGEST:?BROKER_IMAGE_DIGEST is required}"
: "${EXPECTED_BROKER_MODE:?EXPECTED_BROKER_MODE is required}"

if [ "$GCP_PROJECT_ID" != "vaeroex-document-worker" ] || [ "$GCP_REGION" != "us-west1" ]; then
  printf '%s\n' "Only the isolated Phase C1 Google project and region are accepted." >&2
  exit 2
fi

script_directory="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
description="$(mktemp "${TMPDIR:-/tmp}/vaeroex-broker-description.XXXXXX")"
policy="$(mktemp "${TMPDIR:-/tmp}/vaeroex-broker-policy.XXXXXX")"
trap 'rm -f "$description" "$policy"' EXIT HUP INT TERM
chmod 600 "$description" "$policy"

gcloud run services describe "$BROKER_SERVICE" \
  --project "$GCP_PROJECT_ID" \
  --region "$GCP_REGION" \
  --format json >"$description"
gcloud run services get-iam-policy "$BROKER_SERVICE" \
  --project "$GCP_PROJECT_ID" \
  --region "$GCP_REGION" \
  --format json >"$policy"

python3 "$script_directory/verify-preview-broker.py" \
  --description-file "$description" \
  --iam-policy-file "$policy" \
  --service "$BROKER_SERVICE" \
  --service-account "$BROKER_SERVICE_ACCOUNT" \
  --worker-service-account "$WORKER_SERVICE_ACCOUNT" \
  --image-digest "$BROKER_IMAGE_DIGEST" \
  --expected-mode "$EXPECTED_BROKER_MODE"
