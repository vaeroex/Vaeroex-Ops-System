#!/bin/sh
set -eu

: "${GCP_PROJECT_ID:?GCP_PROJECT_ID is required}"
: "${GCP_REGION:?GCP_REGION is required}"
: "${BROKER_IMAGE_TAG:?BROKER_IMAGE_TAG is required}"
: "${PHASE_C1_PREVIEW_CONFIRMATION:?PHASE_C1_PREVIEW_CONFIRMATION is required}"

if [ "$PHASE_C1_PREVIEW_CONFIRMATION" != "vaeroex-document-extraction-phase-c1-preview-only" ]; then
  printf '%s\n' "Preview build confirmation did not match." >&2
  exit 2
fi
if [ "$GCP_PROJECT_ID" != "vaeroex-document-worker" ] || [ "$GCP_REGION" != "us-west1" ]; then
  printf '%s\n' "Only the isolated Phase C1 Google project and region are accepted." >&2
  exit 2
fi

case "$BROKER_IMAGE_TAG" in
  "$GCP_REGION-docker.pkg.dev/$GCP_PROJECT_ID/vaeroex-document-workers-preview/document-extraction-broker":pr265-???????|\
  "$GCP_REGION-docker.pkg.dev/$GCP_PROJECT_ID/vaeroex-document-workers-preview/document-extraction-broker":pr265-????????|\
  "$GCP_REGION-docker.pkg.dev/$GCP_PROJECT_ID/vaeroex-document-workers-preview/document-extraction-broker":pr265-????????????) ;;
  *) printf '%s\n' "BROKER_IMAGE_TAG must be a PR #265 Preview tag." >&2; exit 2 ;;
esac

repository_root="$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)"
gcloud builds submit "$repository_root" \
  --project "$GCP_PROJECT_ID" \
  --config "$repository_root/services/document-extraction-broker/cloudbuild.yaml" \
  --substitutions "_IMAGE=$BROKER_IMAGE_TAG" \
  --quiet >/dev/null

digest="$(gcloud artifacts docker images describe "$BROKER_IMAGE_TAG" \
  --project "$GCP_PROJECT_ID" \
  --format 'value(image_summary.digest)')"
case "$digest" in
  sha256:????????????????????????????????????????????????????????????????) ;;
  *) printf '%s\n' "The broker image digest is unavailable." >&2; exit 2 ;;
esac

printf '%s@%s\n' "${BROKER_IMAGE_TAG%:*}" "$digest"
