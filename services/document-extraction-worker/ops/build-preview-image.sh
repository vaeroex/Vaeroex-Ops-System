#!/bin/sh
set -eu

: "${GCP_PROJECT_ID:?GCP_PROJECT_ID is required}"
: "${GCP_REGION:?GCP_REGION is required}"
: "${IMAGE_TAG:?IMAGE_TAG is required}"
: "${PHASE_C1_PREVIEW_CONFIRMATION:?PHASE_C1_PREVIEW_CONFIRMATION is required}"

if [ "$PHASE_C1_PREVIEW_CONFIRMATION" != "vaeroex-document-extraction-phase-c1-preview-only" ]; then
  printf '%s\n' "Preview image-build confirmation did not match." >&2
  exit 2
fi
if [ "$GCP_PROJECT_ID" != "vaeroex-document-worker" ] || [ "$GCP_REGION" != "us-west1" ]; then
  printf '%s\n' "Only the isolated Phase C1 Google project and region are accepted." >&2
  exit 2
fi
case "$IMAGE_TAG" in
  *[!a-zA-Z0-9._-]*|'') printf '%s\n' "IMAGE_TAG is malformed." >&2; exit 2 ;;
esac

ARTIFACT_REPOSITORY="${ARTIFACT_REPOSITORY:-vaeroex-document-workers-preview}"
IMAGE_NAME="${IMAGE_NAME:-document-extraction-worker}"
if [ "$ARTIFACT_REPOSITORY" != "vaeroex-document-workers-preview" ] \
  || [ "$IMAGE_NAME" != "document-extraction-worker" ]; then
  printf '%s\n' "Only the approved Preview worker image target is accepted." >&2
  exit 2
fi
script_directory="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
worker_root="$(dirname "$script_directory")"
image_tag="$GCP_REGION-docker.pkg.dev/$GCP_PROJECT_ID/$ARTIFACT_REPOSITORY/$IMAGE_NAME:$IMAGE_TAG"

gcloud builds submit "$worker_root" \
  --project "$GCP_PROJECT_ID" \
  --tag "$image_tag" \
  --quiet >/dev/null

digest="$(gcloud artifacts docker images describe "$image_tag" \
  --project "$GCP_PROJECT_ID" \
  --format 'value(image_summary.digest)')"
case "$digest" in
  sha256:????????????????????????????????????????????????????????????????) ;;
  *) printf '%s\n' "The built image digest could not be verified." >&2; exit 3 ;;
esac
printf 'WORKER_IMAGE_DIGEST=%s@%s\n' "${image_tag%:*}" "$digest"
