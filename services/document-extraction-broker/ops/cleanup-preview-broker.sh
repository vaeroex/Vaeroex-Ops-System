#!/bin/sh
set -eu

: "${GCP_PROJECT_ID:?GCP_PROJECT_ID is required}"
: "${GCP_REGION:?GCP_REGION is required}"
: "${BROKER_SERVICE:?BROKER_SERVICE is required}"
: "${BROKER_SERVICE_ACCOUNT:?BROKER_SERVICE_ACCOUNT is required}"
: "${WORKER_SERVICE_ACCOUNT:?WORKER_SERVICE_ACCOUNT is required}"
: "${WORKER_SECRET_VERSION:?WORKER_SECRET_VERSION is required}"
: "${PHASE_C1_PREVIEW_CONFIRMATION:?PHASE_C1_PREVIEW_CONFIRMATION is required}"
: "${PHASE_C1_BROKER_CLEANUP_CONFIRMATION:?PHASE_C1_BROKER_CLEANUP_CONFIRMATION is required}"

if [ "$PHASE_C1_PREVIEW_CONFIRMATION" != "vaeroex-document-extraction-phase-c1-preview-only" ] \
  || [ "$PHASE_C1_BROKER_CLEANUP_CONFIRMATION" != "delete-$BROKER_SERVICE" ]; then
  printf '%s\n' "Ephemeral Preview broker cleanup confirmation did not match." >&2
  exit 2
fi
if [ "$GCP_PROJECT_ID" != "vaeroex-document-worker" ] || [ "$GCP_REGION" != "us-west1" ]; then
  printf '%s\n' "Only the isolated Phase C1 Google project and region are accepted." >&2
  exit 2
fi
case "$BROKER_SERVICE" in
  vaeroex-doc-broker-pr265-???????|vaeroex-doc-broker-pr265-????????|vaeroex-doc-broker-pr265-????????????) ;;
  *) printf '%s\n' "BROKER_SERVICE must be bound to the PR #265 commit." >&2; exit 2 ;;
esac
commit_suffix="${BROKER_SERVICE#vaeroex-doc-broker-pr265-}"
expected_service_account="vx-doc-broker-$commit_suffix@$GCP_PROJECT_ID.iam.gserviceaccount.com"
if [ "$BROKER_SERVICE_ACCOUNT" != "$expected_service_account" ]; then
  printf '%s\n' "BROKER_SERVICE_ACCOUNT is outside the cleanup scope." >&2
  exit 2
fi
case "$WORKER_SERVICE_ACCOUNT" in
  vaeroex-doc-worker-preview@vaeroex-document-worker.iam.gserviceaccount.com) ;;
  *) printf '%s\n' "WORKER_SERVICE_ACCOUNT is outside the cleanup scope." >&2; exit 2 ;;
esac
case "$WORKER_SECRET_VERSION" in
  ''|*[!0-9]*|0) printf '%s\n' "WORKER_SECRET_VERSION must be an exact positive version." >&2; exit 2 ;;
esac
if [ "$WORKER_SECRET_VERSION" -le 1 ]; then
  printf '%s\n' "The original Preview worker secret version must never be destroyed." >&2
  exit 2
fi

if gcloud run services describe "$BROKER_SERVICE" \
  --project "$GCP_PROJECT_ID" --region "$GCP_REGION" >/dev/null 2>&1; then
  gcloud run services remove-iam-policy-binding "$BROKER_SERVICE" \
    --project "$GCP_PROJECT_ID" \
    --region "$GCP_REGION" \
    --member "serviceAccount:$WORKER_SERVICE_ACCOUNT" \
    --role roles/run.invoker \
    --condition=None \
    --quiet >/dev/null || true
  gcloud run services delete "$BROKER_SERVICE" \
    --project "$GCP_PROJECT_ID" \
    --region "$GCP_REGION" \
    --quiet >/dev/null
fi

for suffix in \
  supabase-service-role \
  worker-public-keys \
  capability-keys \
  telemetry-hmac \
  encryption-keys
do
  secret_name="$BROKER_SERVICE-$suffix"
  if gcloud secrets describe "$secret_name" --project "$GCP_PROJECT_ID" >/dev/null 2>&1; then
    versions="$(gcloud secrets versions list "$secret_name" \
      --project "$GCP_PROJECT_ID" \
      --filter 'state:ENABLED OR state:DISABLED' \
      --format 'value(name)')"
    for version in $versions; do
      gcloud secrets versions destroy "${version##*/}" \
        --secret "$secret_name" \
        --project "$GCP_PROJECT_ID" \
        --quiet >/dev/null
    done
    gcloud secrets remove-iam-policy-binding "$secret_name" \
      --project "$GCP_PROJECT_ID" \
      --member "serviceAccount:$BROKER_SERVICE_ACCOUNT" \
      --role roles/secretmanager.secretAccessor \
      --condition=None \
      --quiet >/dev/null || true
    gcloud secrets delete "$secret_name" \
      --project "$GCP_PROJECT_ID" \
      --quiet >/dev/null
  fi
done

worker_secret_state="$(gcloud secrets versions describe "$WORKER_SECRET_VERSION" \
  --secret vaeroex-document-worker-preview-ed25519 \
  --project "$GCP_PROJECT_ID" \
  --format 'value(state)')"
case "$worker_secret_state" in
  ENABLED|DISABLED)
    gcloud secrets versions destroy "$WORKER_SECRET_VERSION" \
      --secret vaeroex-document-worker-preview-ed25519 \
      --project "$GCP_PROJECT_ID" \
      --quiet >/dev/null
    ;;
  DESTROYED) ;;
  *) printf '%s\n' "The qualification worker secret version is unavailable." >&2; exit 3 ;;
esac

project_roles="$(gcloud projects get-iam-policy "$GCP_PROJECT_ID" \
  --flatten 'bindings[].members' \
  --filter "bindings.members:serviceAccount:$BROKER_SERVICE_ACCOUNT" \
  --format 'value(bindings.role)')"
if [ -n "$project_roles" ]; then
  printf '%s\n' "The ephemeral broker service account still has project-level roles." >&2
  exit 3
fi
if gcloud iam service-accounts describe "$BROKER_SERVICE_ACCOUNT" \
  --project "$GCP_PROJECT_ID" >/dev/null 2>&1; then
  gcloud iam service-accounts delete "$BROKER_SERVICE_ACCOUNT" \
    --project "$GCP_PROJECT_ID" \
    --quiet >/dev/null
fi

printf '%s\n' "Ephemeral Preview broker service, IAM, secrets, and qualification worker key removed."
