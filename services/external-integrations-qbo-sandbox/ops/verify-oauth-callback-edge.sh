#!/bin/sh
set -eu

PROJECT_ID="vaeroex-p8b-20260823-84b2f0"
REGION="us-west1"
QUEUE="p8b-qbo"
INGRESS_SERVICE="p8b-ingress"
BROKER_SERVICE="p8b-broker"
BACKEND="p8b-oauth-edge-backend"
PLUGIN="p8b-oauth-callback-edge"
ADDRESS="p8b-oauth-edge-ip"

if [ "${PHASE8B_NONPROD_CONFIRM:-}" != "$PROJECT_ID" ]; then
  printf '%s\n' "Refusing without PHASE8B_NONPROD_CONFIRM=$PROJECT_ID" >&2
  exit 1
fi

EDGE_IP=$(gcloud compute addresses describe "$ADDRESS" \
  --global \
  --project "$PROJECT_ID" \
  --format='value(address)')
EDGE_HOST="p8b-oauth-$(printf '%s' "$EDGE_IP" | tr . -).sslip.io"
EDGE_ORIGIN="https://$EDGE_HOST"
DIRECT_ORIGIN=$(gcloud run services describe "$INGRESS_SERVICE" \
  --region "$REGION" \
  --project "$PROJECT_ID" \
  --format='value(status.url)')
REGISTERED_DIRECT_ORIGIN="https://p8b-ingress-866520189161.us-west1.run.app"
START_TIME=$(date -u +%Y-%m-%dT%H:%M:%SZ)
CODE_CANARY="p8bcode$(openssl rand -hex 24)"
STATE_CANARY="p8bstate_$(openssl rand -hex 24)"
REALM_CANARY="93414552$(openssl rand -hex 8)"
HEADERS_FILE=$(mktemp)
BODY_FILE=$(mktemp)
trap 'rm -f "$HEADERS_FILE" "$BODY_FILE"' EXIT HUP INT TERM

if [ "$(gcloud tasks queues describe "$QUEUE" --location "$REGION" --project "$PROJECT_ID" --format='value(state)')" != "PAUSED" ]; then
  printf '%s\n' "Phase 8B queue is not paused" >&2
  exit 1
fi
if [ "$(gcloud compute backend-services describe "$BACKEND" --global --project "$PROJECT_ID" --format='value(logConfig.enable)')" = "True" ]; then
  printf '%s\n' "Callback backend logging is enabled" >&2
  exit 1
fi
if [ "$(gcloud service-extensions wasm-plugins describe "$PLUGIN" --location global --project "$PROJECT_ID" --format='value(logConfig.enable)')" = "True" ]; then
  printf '%s\n' "Callback plugin logging is enabled" >&2
  exit 1
fi

VALID_STATUS=$(curl --silent --show-error \
  --output "$BODY_FILE" \
  --dump-header "$HEADERS_FILE" \
  --write-out '%{http_code}' \
  "$EDGE_ORIGIN/oauth/callback?code=$CODE_CANARY&state=$STATE_CANARY&realmId=$REALM_CANARY")
if [ "$VALID_STATUS" != "500" ] || [ "$(cat "$BODY_FILE")" != '{"error":"phase8b_request_failed"}' ]; then
  printf '%s\n' "Synthetic nonexistent state did not fail closed with the fixed response" >&2
  exit 1
fi
LOCATION=$(awk 'BEGIN { IGNORECASE=1 } /^location:/ { sub(/^[^:]+:[[:space:]]*/, ""); sub(/\r$/, ""); print; exit }' "$HEADERS_FILE")
if [ -n "$LOCATION" ]; then
  printf '%s\n' "Rejected synthetic callback returned a location" >&2
  exit 1
fi
if grep -F "$CODE_CANARY" "$BODY_FILE" >/dev/null ||
   grep -F "$STATE_CANARY" "$BODY_FILE" >/dev/null ||
   grep -F "$REALM_CANARY" "$BODY_FILE" >/dev/null; then
  printf '%s\n' "Rejected synthetic callback reflected sensitive material" >&2
  exit 1
fi

assert_edge_status() {
  expected=$1
  shift
  label=$1
  shift
  actual=$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' "$@")
  if [ "$actual" != "$expected" ]; then
    printf '%s\n' "Edge check failed: $label (expected $expected, received $actual)" >&2
    exit 1
  fi
}

assert_edge_status 400 duplicate-code "$EDGE_ORIGIN/oauth/callback?code=$CODE_CANARY&code=forged&state=$STATE_CANARY&realmId=$REALM_CANARY"
assert_edge_status 400 missing-realm "$EDGE_ORIGIN/oauth/callback?code=$CODE_CANARY&state=$STATE_CANARY"
assert_edge_status 400 forged-handoff-without-query -H 'x-vaeroex-oauth-handoff-version: qbo_oauth_callback_handoff_v1' -H 'x-vaeroex-oauth-code: forged-code' -H 'x-vaeroex-oauth-state: forged-state' -H 'x-vaeroex-oauth-realm-id: forged-realm' "$EDGE_ORIGIN/oauth/callback"
assert_edge_status 500 forged-handoff-overwritten -H 'x-vaeroex-oauth-handoff-version: forged-version' -H 'x-vaeroex-oauth-code: forged code' -H 'x-vaeroex-oauth-state: forged/state' -H 'x-vaeroex-oauth-realm-id: /forged' "$EDGE_ORIGIN/oauth/callback?code=$CODE_CANARY&state=$STATE_CANARY&realmId=$REALM_CANARY"
assert_edge_status 400 callback-body -X POST --data 'forbidden' "$EDGE_ORIGIN/oauth/callback?code=$CODE_CANARY&state=$STATE_CANARY&realmId=$REALM_CANARY"
OVERSIZED_CODE=$(awk 'BEGIN { for (i = 0; i < 8193; i++) printf "a" }')
assert_edge_status 400 oversized-code "$EDGE_ORIGIN/oauth/callback?code=$OVERSIZED_CODE&state=$STATE_CANARY&realmId=$REALM_CANARY"
assert_edge_status 200 fixed-confirmation "$EDGE_ORIGIN/oauth/confirmed"
assert_edge_status 400 confirmation-query "$EDGE_ORIGIN/oauth/confirmed?state=$STATE_CANARY"

DIRECT_STATUS=$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' "$DIRECT_ORIGIN/oauth/callback")
case "$DIRECT_STATUS" in
  200|303) printf '%s\n' "Direct Cloud Run bypass remains available" >&2; exit 1 ;;
esac
REGISTERED_DIRECT_STATUS=$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' "$REGISTERED_DIRECT_ORIGIN/oauth/callback")
case "$REGISTERED_DIRECT_STATUS" in
  200|303) printf '%s\n' "Registered direct Cloud Run callback remains publicly available" >&2; exit 1 ;;
esac

sleep 45
CANARY_FILTER="timestamp>=\"$START_TIME\" AND (\"$CODE_CANARY\" OR \"$STATE_CANARY\" OR \"$REALM_CANARY\")"
if [ -n "$(gcloud logging read "$CANARY_FILTER" --project "$PROJECT_ID" --limit 1 --format='value(insertId)')" ]; then
  printf '%s\n' "Synthetic callback canary persisted in Cloud Logging" >&2
  exit 1
fi

CALLBACK_REQUEST_LOG=$(gcloud logging read \
  "timestamp>=\"$START_TIME\" AND resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"$INGRESS_SERVICE\" AND logName=\"projects/$PROJECT_ID/logs/run.googleapis.com%2Frequests\"" \
  --project "$PROJECT_ID" \
  --limit 1 \
  --order desc \
  --format='value(insertId)')
if [ -n "$CALLBACK_REQUEST_LOG" ]; then
  printf '%s\n' "Callback request log bypassed the disposable sink exclusion" >&2
  exit 1
fi
set -- $(gcloud logging read \
  "timestamp>=\"$START_TIME\" AND resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"$BROKER_SERVICE\" AND logName=\"projects/$PROJECT_ID/logs/run.googleapis.com%2Frequests\" AND httpRequest.requestMethod=\"POST\"" \
  --project "$PROJECT_ID" \
  --limit 4 \
  --order desc \
  --format='value(insertId)')
if [ "$#" -ne 4 ]; then
  printf '%s\n' "The clean handoff did not reach the private broker for both fail-closed probes" >&2
  exit 1
fi

printf '%s\n' "callback_edge_canary=pass"
printf '%s\n' "direct_bypass=denied"
printf '%s\n' "cloud_logging_canary_matches=0"
printf '%s\n' "cloud_run_callback_request_entries=0"
printf '%s\n' "private_broker_fail_closed_requests=4"
