#!/bin/sh
set -eu

PROJECT_ID="vaeroex-p8b-20260823-84b2f0"
REGION="us-west1"

if [ "${PHASE8B_NONPROD_CONFIRM:-}" != "$PROJECT_ID" ] || [ "${PHASE8B_EDGE_CLEANUP_CONFIRM:-}" != "delete-phase8b-oauth-edge" ]; then
  printf '%s\n' "Refusing disposable edge cleanup without both exact confirmations" >&2
  exit 1
fi

gcloud run services update p8b-ingress --ingress internal --region "$REGION" --project "$PROJECT_ID" --quiet >/dev/null
gcloud service-extensions lb-traffic-extensions delete p8b-oauth-callback-edge --location global --project "$PROJECT_ID" --quiet || true
gcloud service-extensions lb-edge-extensions delete p8b-oauth-callback-edge --location global --project "$PROJECT_ID" --quiet || true
gcloud service-extensions wasm-plugins delete p8b-oauth-callback-edge --location global --project "$PROJECT_ID" --quiet || true
gcloud compute forwarding-rules delete p8b-oauth-edge-forwarding-rule --global --project "$PROJECT_ID" --quiet || true
gcloud compute target-https-proxies delete p8b-oauth-edge-https-proxy --global --project "$PROJECT_ID" --quiet || true
gcloud compute url-maps delete p8b-oauth-edge-url-map --global --project "$PROJECT_ID" --quiet || true
gcloud compute backend-services delete p8b-oauth-edge-backend --global --project "$PROJECT_ID" --quiet || true
gcloud compute network-endpoint-groups delete p8b-oauth-edge-neg --region "$REGION" --project "$PROJECT_ID" --quiet || true
gcloud compute ssl-certificates delete p8b-oauth-edge-cert --global --project "$PROJECT_ID" --quiet || true
gcloud compute addresses delete p8b-oauth-edge-ip --global --project "$PROJECT_ID" --quiet || true
gcloud artifacts repositories remove-iam-policy-binding p8b-oauth-edge --location us --member "serviceAccount:p8b-oauth-edge-build@$PROJECT_ID.iam.gserviceaccount.com" --role roles/artifactregistry.writer --project "$PROJECT_ID" --quiet || true
gcloud storage buckets remove-iam-policy-binding "gs://${PROJECT_ID}_cloudbuild" --member "serviceAccount:p8b-oauth-edge-build@$PROJECT_ID.iam.gserviceaccount.com" --role roles/storage.objectViewer --project "$PROJECT_ID" --quiet || true
gcloud projects remove-iam-policy-binding "$PROJECT_ID" --member "serviceAccount:p8b-oauth-edge-build@$PROJECT_ID.iam.gserviceaccount.com" --role roles/logging.logWriter --condition=None --quiet || true
gcloud iam service-accounts delete "p8b-oauth-edge-build@$PROJECT_ID.iam.gserviceaccount.com" --project "$PROJECT_ID" --quiet || true
