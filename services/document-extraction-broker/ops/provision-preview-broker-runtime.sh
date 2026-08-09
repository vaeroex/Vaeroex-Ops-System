#!/bin/sh
set -eu

: "${GCP_PROJECT_ID:?GCP_PROJECT_ID is required}"
: "${GCP_REGION:?GCP_REGION is required}"
: "${BROKER_SERVICE:?BROKER_SERVICE is required}"
: "${BROKER_SERVICE_ACCOUNT:?BROKER_SERVICE_ACCOUNT is required}"
: "${PHASE_C1_PREVIEW_CONFIRMATION:?PHASE_C1_PREVIEW_CONFIRMATION is required}"

if [ "$PHASE_C1_PREVIEW_CONFIRMATION" != "vaeroex-document-extraction-phase-c1-preview-only" ]; then
  printf '%s\n' "Preview broker provisioning confirmation did not match." >&2
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
  printf '%s\n' "BROKER_SERVICE_ACCOUNT must be bound to the same PR commit." >&2
  exit 2
fi

service_account_name="${BROKER_SERVICE_ACCOUNT%%@*}"
if ! gcloud iam service-accounts describe "$BROKER_SERVICE_ACCOUNT" \
  --project "$GCP_PROJECT_ID" >/dev/null 2>&1; then
  gcloud iam service-accounts create "$service_account_name" \
    --project "$GCP_PROJECT_ID" \
    --display-name "Ephemeral PR 265 document broker $commit_suffix" \
    --quiet >/dev/null
fi

project_roles="$(gcloud projects get-iam-policy "$GCP_PROJECT_ID" \
  --flatten 'bindings[].members' \
  --filter "bindings.members:serviceAccount:$BROKER_SERVICE_ACCOUNT" \
  --format 'value(bindings.role)')"
if [ -n "$project_roles" ]; then
  printf '%s\n' "The ephemeral broker service account has unexpected project-level roles." >&2
  exit 3
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
    printf '%s\n' "An ephemeral broker secret already exists; cleanup is required before provisioning." >&2
    exit 3
  fi
  gcloud secrets create "$secret_name" \
    --project "$GCP_PROJECT_ID" \
    --replication-policy user-managed \
    --locations "$GCP_REGION" \
    --labels "vaeroex_phase=phase-c1,vaeroex_pr=265,vaeroex_environment=preview" \
    --quiet >/dev/null
  gcloud secrets add-iam-policy-binding "$secret_name" \
    --project "$GCP_PROJECT_ID" \
    --member "serviceAccount:$BROKER_SERVICE_ACCOUNT" \
    --role roles/secretmanager.secretAccessor \
    --condition=None \
    --quiet >/dev/null
done

printf '%s\n' "Ephemeral Preview broker identity and empty secret containers provisioned."
printf 'BROKER_SERVICE_ACCOUNT=%s\n' "$BROKER_SERVICE_ACCOUNT"
printf 'BROKER_SECRET_PREFIX=%s\n' "$BROKER_SERVICE"
