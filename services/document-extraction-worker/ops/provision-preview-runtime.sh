#!/bin/sh
set -eu

: "${GCP_PROJECT_ID:?GCP_PROJECT_ID is required}"
: "${GCP_REGION:?GCP_REGION is required}"
: "${PHASE_C1_PREVIEW_CONFIRMATION:?PHASE_C1_PREVIEW_CONFIRMATION is required}"

if [ "$PHASE_C1_PREVIEW_CONFIRMATION" != "vaeroex-document-extraction-phase-c1-preview-only" ]; then
  printf '%s\n' "Preview runtime-provisioning confirmation did not match." >&2
  exit 2
fi
if [ "$GCP_PROJECT_ID" != "vaeroex-document-worker" ] || [ "$GCP_REGION" != "us-west1" ]; then
  printf '%s\n' "Only the isolated Phase C1 Google project and region are accepted." >&2
  exit 2
fi

SERVICE_ACCOUNT_NAME="${SERVICE_ACCOUNT_NAME:-vaeroex-doc-worker-preview}"
ARTIFACT_REPOSITORY="${ARTIFACT_REPOSITORY:-vaeroex-document-workers-preview}"
WORKER_SERVICE_ACCOUNT="$SERVICE_ACCOUNT_NAME@$GCP_PROJECT_ID.iam.gserviceaccount.com"
if [ "$SERVICE_ACCOUNT_NAME" != "vaeroex-doc-worker-preview" ] \
  || [ "$ARTIFACT_REPOSITORY" != "vaeroex-document-workers-preview" ]; then
  printf '%s\n' "The Preview runtime target is outside the approved scope." >&2
  exit 2
fi

gcloud services enable \
  run.googleapis.com \
  secretmanager.googleapis.com \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  logging.googleapis.com \
  monitoring.googleapis.com \
  --project "$GCP_PROJECT_ID" \
  --quiet >/dev/null

if ! gcloud iam service-accounts describe "$WORKER_SERVICE_ACCOUNT" \
  --project "$GCP_PROJECT_ID" >/dev/null 2>&1; then
  gcloud iam service-accounts create "$SERVICE_ACCOUNT_NAME" \
    --project "$GCP_PROJECT_ID" \
    --display-name "Vaeroex Preview document extraction worker" >/dev/null
fi

project_roles="$(gcloud projects get-iam-policy "$GCP_PROJECT_ID" \
  --flatten 'bindings[].members' \
  --filter "bindings.members:serviceAccount:$WORKER_SERVICE_ACCOUNT" \
  --format 'value(bindings.role)')"
if [ -n "$project_roles" ]; then
  printf '%s\n' "The Preview worker service account has unexpected project-level roles." >&2
  exit 3
fi

if ! gcloud artifacts repositories describe "$ARTIFACT_REPOSITORY" \
  --project "$GCP_PROJECT_ID" \
  --location "$GCP_REGION" >/dev/null 2>&1; then
  gcloud artifacts repositories create "$ARTIFACT_REPOSITORY" \
    --project "$GCP_PROJECT_ID" \
    --location "$GCP_REGION" \
    --repository-format docker \
    --description "Inert Vaeroex Preview document extraction worker images" >/dev/null
fi

printf 'WORKER_SERVICE_ACCOUNT=%s\n' "$WORKER_SERVICE_ACCOUNT"
printf 'ARTIFACT_REPOSITORY=%s\n' "$ARTIFACT_REPOSITORY"
printf '%s\n' "Preview worker runtime provisioned without project-level runtime roles."
