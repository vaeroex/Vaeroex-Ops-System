#!/bin/sh
set -eu

PROJECT_ID="vaeroex-p8b-20260823-84b2f0"
REGION="us-west1"
QUEUE="p8b-qbo"
INGRESS_SERVICE="p8b-ingress"
BROKER_SERVICE="p8b-broker"
CURRENT_CALLBACK="https://p8b-ingress-866520189161.us-west1.run.app/oauth/callback"
ADDRESS="p8b-oauth-edge-ip"
CERTIFICATE="p8b-oauth-edge-cert"
NEG="p8b-oauth-edge-neg"
BACKEND="p8b-oauth-edge-backend"
URL_MAP="p8b-oauth-edge-url-map"
HTTPS_PROXY="p8b-oauth-edge-https-proxy"
FORWARDING_RULE="p8b-oauth-edge-forwarding-rule"
PLUGIN="p8b-oauth-callback-edge"
PLUGIN_VERSION="v6"
TRAFFIC_EXTENSION="p8b-oauth-callback-edge"
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
EXTENSION_FILE="$SCRIPT_DIR/../edge/lb-traffic-extension.yaml"

if [ "${PHASE8B_NONPROD_CONFIRM:-}" != "$PROJECT_ID" ]; then
  printf '%s\n' "Refusing without PHASE8B_NONPROD_CONFIRM=$PROJECT_ID" >&2
  exit 1
fi

PLUGIN_IMAGE=${PHASE8B_EDGE_PLUGIN_IMAGE:-}
case "$PLUGIN_IMAGE" in
  us-docker.pkg.dev/$PROJECT_ID/p8b-oauth-edge/callback-query-stripper@sha256:????????????????????????????????????????????????????????????????) ;;
  *) printf '%s\n' "PHASE8B_EDGE_PLUGIN_IMAGE must be an immutable disposable-project digest" >&2; exit 1 ;;
esac

QUEUE_STATE=$(gcloud tasks queues describe "$QUEUE" \
  --location "$REGION" \
  --project "$PROJECT_ID" \
  --format='value(state)')
if [ "$QUEUE_STATE" != "PAUSED" ]; then
  printf '%s\n' "Phase 8B queue is not paused" >&2
  exit 1
fi

CONFIGURED_CALLBACK=$(gcloud run services describe "$BROKER_SERVICE" \
  --region "$REGION" \
  --project "$PROJECT_ID" \
  --format=json | jq -r '.spec.template.spec.containers[0].env[] | select(.name == "PHASE8B_CALLBACK_URL") | .value')
if [ "$CONFIGURED_CALLBACK" != "$CURRENT_CALLBACK" ]; then
  printf '%s\n' "Development callback changed before approved cutover" >&2
  exit 1
fi

gcloud services enable \
  compute.googleapis.com \
  networkactions.googleapis.com \
  networkservices.googleapis.com \
  --project "$PROJECT_ID" \
  --quiet

if ! gcloud compute addresses describe "$ADDRESS" --global --project "$PROJECT_ID" >/dev/null 2>&1; then
  gcloud compute addresses create "$ADDRESS" \
    --global \
    --ip-version IPV4 \
    --network-tier PREMIUM \
    --project "$PROJECT_ID" \
    --quiet
fi
EDGE_IP=$(gcloud compute addresses describe "$ADDRESS" \
  --global \
  --project "$PROJECT_ID" \
  --format='value(address)')
EDGE_HOST="p8b-oauth-$(printf '%s' "$EDGE_IP" | tr . -).sslip.io"

if ! gcloud compute ssl-certificates describe "$CERTIFICATE" --global --project "$PROJECT_ID" >/dev/null 2>&1; then
  gcloud compute ssl-certificates create "$CERTIFICATE" \
    --domains "$EDGE_HOST" \
    --global \
    --project "$PROJECT_ID" \
    --quiet
fi

if ! gcloud compute network-endpoint-groups describe "$NEG" --region "$REGION" --project "$PROJECT_ID" >/dev/null 2>&1; then
  gcloud compute network-endpoint-groups create "$NEG" \
    --region "$REGION" \
    --network-endpoint-type serverless \
    --cloud-run-service "$INGRESS_SERVICE" \
    --project "$PROJECT_ID" \
    --quiet
fi

if ! gcloud compute backend-services describe "$BACKEND" --global --project "$PROJECT_ID" >/dev/null 2>&1; then
  gcloud compute backend-services create "$BACKEND" \
    --global \
    --load-balancing-scheme EXTERNAL_MANAGED \
    --protocol HTTP \
    --no-enable-logging \
    --project "$PROJECT_ID" \
    --quiet
  gcloud compute backend-services add-backend "$BACKEND" \
    --global \
    --network-endpoint-group "$NEG" \
    --network-endpoint-group-region "$REGION" \
    --project "$PROJECT_ID" \
    --quiet
fi

if ! gcloud compute url-maps describe "$URL_MAP" --global --project "$PROJECT_ID" >/dev/null 2>&1; then
  gcloud compute url-maps create "$URL_MAP" \
    --default-service "$BACKEND" \
    --global \
    --project "$PROJECT_ID" \
    --quiet
fi

if ! gcloud compute target-https-proxies describe "$HTTPS_PROXY" --global --project "$PROJECT_ID" >/dev/null 2>&1; then
  gcloud compute target-https-proxies create "$HTTPS_PROXY" \
    --url-map "$URL_MAP" \
    --ssl-certificates "$CERTIFICATE" \
    --global \
    --project "$PROJECT_ID" \
    --quiet
fi

if ! gcloud compute forwarding-rules describe "$FORWARDING_RULE" --global --project "$PROJECT_ID" >/dev/null 2>&1; then
  gcloud compute forwarding-rules create "$FORWARDING_RULE" \
    --address "$ADDRESS" \
    --global \
    --load-balancing-scheme EXTERNAL_MANAGED \
    --network-tier PREMIUM \
    --ports 443 \
    --target-https-proxy "$HTTPS_PROXY" \
    --project "$PROJECT_ID" \
    --quiet
fi

if ! gcloud service-extensions wasm-plugins describe "$PLUGIN" --location global --project "$PROJECT_ID" >/dev/null 2>&1; then
  gcloud service-extensions wasm-plugins create "$PLUGIN" \
    --location global \
    --description "Disposable Phase 8B bounded OAuth callback query handoff" \
    --labels phase=8b,environment=disposable,provider=qbo \
    --log-config enable=false \
    --image "$PLUGIN_IMAGE" \
    --main-version "$PLUGIN_VERSION" \
    --project "$PROJECT_ID" \
    --quiet
else
  if ! gcloud service-extensions wasm-plugin-versions describe "$PLUGIN_VERSION" --wasm-plugin "$PLUGIN" --location global --project "$PROJECT_ID" >/dev/null 2>&1; then
    gcloud service-extensions wasm-plugins update "$PLUGIN" \
      --location global \
      --image "$PLUGIN_IMAGE" \
      --main-version "$PLUGIN_VERSION" \
      --project "$PROJECT_ID" \
      --quiet
  fi
  DEPLOYED_PLUGIN_IMAGE=$(gcloud service-extensions wasm-plugin-versions describe "$PLUGIN_VERSION" --wasm-plugin "$PLUGIN" --location global --project "$PROJECT_ID" --format='value(imageUri)')
  if [ "$DEPLOYED_PLUGIN_IMAGE" != "$PLUGIN_IMAGE" ]; then
    printf '%s\n' "Existing callback plugin version does not match the approved immutable image" >&2
    exit 1
  fi
fi

gcloud service-extensions lb-traffic-extensions import "$TRAFFIC_EXTENSION" \
  --source "$EXTENSION_FILE" \
  --location global \
  --project "$PROJECT_ID" \
  --quiet

gcloud run services update "$INGRESS_SERVICE" \
  --ingress internal-and-cloud-load-balancing \
  --region "$REGION" \
  --project "$PROJECT_ID" \
  --quiet >/dev/null

printf '%s\n' "https://$EDGE_HOST/oauth/callback"
