#!/bin/sh
set -eu

PROJECT_ID="vaeroex-p8b-20260823-84b2f0"
ARTIFACT_LOCATION="us"
REPOSITORY="p8b-oauth-edge"
IMAGE_NAME="callback-query-stripper"
BUILDER_NAME="p8b-oauth-edge-build"
BUILDER_ACCOUNT="$BUILDER_NAME@$PROJECT_ID.iam.gserviceaccount.com"
SOURCE_BUCKET="gs://${PROJECT_ID}_cloudbuild"
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
EDGE_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/../edge" && pwd)

if [ "${PHASE8B_NONPROD_CONFIRM:-}" != "$PROJECT_ID" ]; then
  printf '%s\n' "Refusing without PHASE8B_NONPROD_CONFIRM=$PROJECT_ID" >&2
  exit 1
fi

gcloud services enable \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  --project "$PROJECT_ID" \
  --quiet

if ! gcloud artifacts repositories describe "$REPOSITORY" \
  --location "$ARTIFACT_LOCATION" \
  --project "$PROJECT_ID" >/dev/null 2>&1; then
  gcloud artifacts repositories create "$REPOSITORY" \
    --repository-format docker \
    --location "$ARTIFACT_LOCATION" \
    --description "Disposable Phase 8B OAuth callback edge" \
    --project "$PROJECT_ID" \
    --quiet
fi

if ! gcloud iam service-accounts describe "$BUILDER_ACCOUNT" --project "$PROJECT_ID" >/dev/null 2>&1; then
  gcloud iam service-accounts create "$BUILDER_NAME" \
    --display-name "Disposable Phase 8B OAuth edge builder" \
    --description "Keyless build identity for the disposable callback Wasm artifact" \
    --project "$PROJECT_ID"
fi

ATTEMPT=0
until gcloud storage buckets add-iam-policy-binding "$SOURCE_BUCKET" \
  --member "serviceAccount:$BUILDER_ACCOUNT" \
  --role roles/storage.objectViewer \
  --project "$PROJECT_ID" \
  --quiet >/dev/null 2>&1; do
  ATTEMPT=$((ATTEMPT + 1))
  if [ "$ATTEMPT" -ge 12 ]; then
    printf '%s\n' "Builder identity did not propagate to Cloud Storage IAM" >&2
    exit 1
  fi
  sleep 5
done
gcloud artifacts repositories add-iam-policy-binding "$REPOSITORY" \
  --location "$ARTIFACT_LOCATION" \
  --member "serviceAccount:$BUILDER_ACCOUNT" \
  --role roles/artifactregistry.writer \
  --project "$PROJECT_ID" \
  --quiet >/dev/null
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member "serviceAccount:$BUILDER_ACCOUNT" \
  --role roles/logging.logWriter \
  --condition=None \
  --quiet >/dev/null

SOURCE_SHA=$(find "$EDGE_DIR" -type f \
  ! -path '*/package/plugin.wasm' \
  ! -name '.DS_Store' \
  -print0 | sort -z | xargs -0 shasum -a 256 | shasum -a 256 | cut -c1-16)
IMAGE_URI="$ARTIFACT_LOCATION-docker.pkg.dev/$PROJECT_ID/$REPOSITORY/$IMAGE_NAME:v1-$SOURCE_SHA"

gcloud builds submit "$EDGE_DIR" \
  --config "$EDGE_DIR/cloudbuild.yaml" \
  --substitutions "_PLUGIN_IMAGE=$IMAGE_URI" \
  --service-account "projects/$PROJECT_ID/serviceAccounts/$BUILDER_ACCOUNT" \
  --project "$PROJECT_ID" \
  --quiet

IMAGE_DIGEST=$(gcloud artifacts docker images describe "$IMAGE_URI" \
  --project "$PROJECT_ID" \
  --format='value(image_summary.digest)')
case "$IMAGE_DIGEST" in
  sha256:????????????????????????????????????????????????????????????????) ;;
  *) printf '%s\n' "Unable to resolve immutable plugin digest" >&2; exit 1 ;;
esac

printf '%s@%s\n' "${IMAGE_URI%:*}" "$IMAGE_DIGEST"
