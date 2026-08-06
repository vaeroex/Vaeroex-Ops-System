#!/bin/sh
set -eu

: "${GCP_PROJECT_ID:?GCP_PROJECT_ID is required}"
: "${GCP_REGION:?GCP_REGION is required}"
: "${WORKER_MODE:?WORKER_MODE is required}"
: "${PHASE_C1_PREVIEW_CONFIRMATION:?PHASE_C1_PREVIEW_CONFIRMATION is required}"
: "${GOOGLE_QUALIFICATION_CONFIRMATION:?GOOGLE_QUALIFICATION_CONFIRMATION is required}"

WORKER_POOL="${WORKER_POOL:-vaeroex-document-extraction-preview}"

if [ "$PHASE_C1_PREVIEW_CONFIRMATION" != "vaeroex-document-extraction-phase-c1-preview-only" ]; then
  printf '%s\n' "Preview environment confirmation did not match." >&2
  exit 2
fi
if [ "$GCP_PROJECT_ID" != "vaeroex-document-worker" ] \
  || [ "$GCP_REGION" != "us-west1" ] \
  || [ "$WORKER_POOL" != "vaeroex-document-extraction-preview" ]; then
  printf '%s\n' "Only the isolated Preview worker may change mode." >&2
  exit 2
fi

case "$WORKER_MODE" in
  disabled)
    test "$GOOGLE_QUALIFICATION_CONFIRMATION" = "disable-google-document-ai-preview"
    ;;
  authentication)
    test "$GOOGLE_QUALIFICATION_CONFIRMATION" = "google-document-ai-auth-zero-provider-calls"
    ;;
  one-page)
    test "$GOOGLE_QUALIFICATION_CONFIRMATION" = "google-document-ai-one-page-one-call-zero-retry"
    ;;
  frozen-corpus)
    test "$GOOGLE_QUALIFICATION_CONFIRMATION" = "google-document-ai-frozen-corpus-8-documents-9-pages-zero-retry"
    ;;
  *) printf '%s\n' "WORKER_MODE is invalid." >&2; exit 2 ;;
esac

script_directory="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
current_description="$(mktemp "${TMPDIR:-/tmp}/vaeroex-google-worker-current.XXXXXX")"
rendered_manifest="$(mktemp "${TMPDIR:-/tmp}/vaeroex-google-worker-mode.XXXXXX")"
deployed_description="$(mktemp "${TMPDIR:-/tmp}/vaeroex-google-worker-deployed.XXXXXX")"
trap 'rm -f "$current_description" "$rendered_manifest" "$deployed_description"' EXIT HUP INT TERM

gcloud run worker-pools describe "$WORKER_POOL" \
  --project "$GCP_PROJECT_ID" \
  --region "$GCP_REGION" \
  --format json >"$current_description"

set -- \
  --description-file "$current_description" \
  --output "$rendered_manifest" \
  --worker-pool "$WORKER_POOL" \
  --mode "$WORKER_MODE"
python3 "$script_directory/render-google-document-ai-worker-mode.py" "$@"

CLOUDSDK_RUN_REGION="$GCP_REGION" gcloud run worker-pools replace "$rendered_manifest" \
  --project "$GCP_PROJECT_ID" \
  --quiet >/dev/null

gcloud run worker-pools describe "$WORKER_POOL" \
  --project "$GCP_PROJECT_ID" \
  --region "$GCP_REGION" \
  --format json >"$deployed_description"

python3 "$script_directory/render-google-document-ai-worker-mode.py" \
  --description-file "$deployed_description" \
  --worker-pool "$WORKER_POOL" \
  --mode "$WORKER_MODE" \
  --verify-only

printf '%s\n' "Google Document AI Preview worker mode updated: $WORKER_MODE."
