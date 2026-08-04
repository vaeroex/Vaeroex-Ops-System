#!/bin/sh
set -eu

: "${GCP_PROJECT_ID:?GCP_PROJECT_ID is required}"
: "${GCP_REGION:?GCP_REGION is required}"

WORKER_POOL="${WORKER_POOL:-vaeroex-document-extraction-preview}"
SIGNAL_WINDOW="${SIGNAL_WINDOW:-30m}"
case "$SIGNAL_WINDOW" in
  *[!0-9mhd]*|'') printf '%s\n' "SIGNAL_WINDOW is malformed." >&2; exit 2 ;;
esac

script_directory="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
signals="$(mktemp "${TMPDIR:-/tmp}/vaeroex-worker-signals.XXXXXX")"
trap 'rm -f "$signals"' EXIT HUP INT TERM
chmod 600 "$signals"

filter="resource.type=\"cloud_run_workerpool\" AND resource.labels.location=\"$GCP_REGION\" AND (resource.labels.workerpool_name=\"$WORKER_POOL\" OR resource.labels.worker_pool_name=\"$WORKER_POOL\")"
gcloud logging read "$filter" \
  --project "$GCP_PROJECT_ID" \
  --freshness "$SIGNAL_WINDOW" \
  --limit 1000 \
  --format json >"$signals"

python3 "$script_directory/summarize-worker-signals.py" "$signals"
