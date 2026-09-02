#!/bin/sh
set -eu

PROJECT_ID="vaeroex-p8b-20260823-84b2f0"
REGION="us-west1"
MAIN_QUEUE="p8b-qbo"
CANARY_QUEUE="p8b-qbo-canary"
CANARY_TASK_ID="edb562b4-11fa-4bc4-93ea-2bb50e4d7f15"
CANARY_RUNTIME_SERVICE="p8b-runtime-canary"
CANARY_DISPATCHER_SERVICE="p8b-dispatcher-canary"

required() {
  variable_name=$1
  eval "variable_value=\${$variable_name:-}"
  if [ -z "$variable_value" ]; then
    printf '%s\n' "Missing required configuration: $variable_name" >&2
    exit 1
  fi
  printf '%s' "$variable_value"
}

if [ "${PHASE8B_NONPROD_CONFIRM:-}" != "$PROJECT_ID" ]; then
  printf '%s\n' "Refusing without PHASE8B_NONPROD_CONFIRM=$PROJECT_ID" >&2
  exit 1
fi

IMAGE=$(required PHASE8B_CANARY_IMAGE)
case "$IMAGE" in
  us-west1-docker.pkg.dev/$PROJECT_ID/*@sha256:????????????????????????????????????????????????????????????????) ;;
  *)
    printf '%s\n' "PHASE8B_CANARY_IMAGE must be an immutable disposable-project digest" >&2
    exit 1
    ;;
esac

SOURCE_COMMIT=$(required PHASE8B_CANARY_SOURCE_COMMIT)
case "$SOURCE_COMMIT" in
  [0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]) ;;
  *) printf '%s\n' "PHASE8B_CANARY_SOURCE_COMMIT must be a full commit SHA" >&2; exit 1 ;;
esac

DATABASE_SECRET=$(required PHASE8B_DATABASE_SECRET_VERSION_RESOURCE)
case "$DATABASE_SECRET" in
  projects/$PROJECT_ID/secrets/*/versions/[1-9]*) ;;
  *) printf '%s\n' "DATABASE_URL must use an explicit disposable-project Secret Manager version" >&2; exit 1 ;;
esac

BROKER_URL=$(required PHASE8B_BROKER_URL)
DISPATCHER_SERVICE_ACCOUNT=$(required PHASE8B_DISPATCHER_SERVICE_ACCOUNT)
RUNTIME_SERVICE_ACCOUNT=$(required PHASE8B_RUNTIME_SERVICE_ACCOUNT)
RUNTIME_INVOKER_SERVICE_ACCOUNT=$(required PHASE8B_RUNTIME_INVOKER_SERVICE_ACCOUNT)
WORKSPACE_ID=$(required PHASE8B_WORKSPACE_ID)
BUSINESS_ENTITY_ID=$(required PHASE8B_BUSINESS_ENTITY_ID)
CONNECTION_ID=$(required PHASE8B_CONNECTION_ID)
INITIATED_BY=$(required PHASE8B_INITIATED_BY)
MAPPING_ID=$(required PHASE8B_MAPPING_ID)
SANDBOX_REALM_ID=$(required PHASE8B_SANDBOX_REALM_ID)

case "$BROKER_URL" in
  https://p8b-broker-*.us-west1.run.app/) ;;
  *) printf '%s\n' "PHASE8B_BROKER_URL must identify the isolated Phase 8B broker" >&2; exit 1 ;;
esac
for service_account in \
  "$DISPATCHER_SERVICE_ACCOUNT" \
  "$RUNTIME_SERVICE_ACCOUNT" \
  "$RUNTIME_INVOKER_SERVICE_ACCOUNT"
do
  case "$service_account" in
    *@$PROJECT_ID.iam.gserviceaccount.com) ;;
    *) printf '%s\n' "Canary service accounts must belong to the disposable project" >&2; exit 1 ;;
  esac
done

MAIN_QUEUE_STATE=$(gcloud tasks queues describe "$MAIN_QUEUE" \
  --location "$REGION" \
  --project "$PROJECT_ID" \
  --format='value(state)')
if [ "$MAIN_QUEUE_STATE" != "PAUSED" ]; then
  printf '%s\n' "Main Phase 8B queue is not paused" >&2
  exit 1
fi

if ! gcloud tasks queues describe "$CANARY_QUEUE" \
  --location "$REGION" \
  --project "$PROJECT_ID" >/dev/null 2>&1
then
  gcloud tasks queues create "$CANARY_QUEUE" \
    --location "$REGION" \
    --project "$PROJECT_ID" \
    --max-concurrent-dispatches 1 \
    --max-dispatches-per-second 1 \
    --quiet
fi
gcloud tasks queues update "$CANARY_QUEUE" \
  --location "$REGION" \
  --project "$PROJECT_ID" \
  --max-concurrent-dispatches 1 \
  --max-dispatches-per-second 1 \
  --quiet
gcloud tasks queues pause "$CANARY_QUEUE" \
  --location "$REGION" \
  --project "$PROJECT_ID" \
  --quiet

COMMON_ENV="PHASE8B_WORKSPACE_ID=$WORKSPACE_ID,PHASE8B_BUSINESS_ENTITY_ID=$BUSINESS_ENTITY_ID,PHASE8B_CONNECTION_ID=$CONNECTION_ID,PHASE8B_CONNECTION_GENERATION=1,PHASE8B_INITIATED_BY=$INITIATED_BY,PHASE8B_MAPPING_ID=$MAPPING_ID,PHASE8B_QUEUE_NAME=$CANARY_QUEUE,PHASE8B_SOURCE_COMMIT=$SOURCE_COMMIT"

gcloud run deploy "$CANARY_RUNTIME_SERVICE" \
  --project "$PROJECT_ID" \
  --region "$REGION" \
  --image "$IMAGE" \
  --service-account "$RUNTIME_SERVICE_ACCOUNT" \
  --ingress internal \
  --no-allow-unauthenticated \
  --concurrency 1 \
  --max-instances 1 \
  --set-env-vars "PHASE8B_SERVICE_MODE=provider_runtime,PHASE8B_BROKER_URL=$BROKER_URL,PHASE8B_SANDBOX_REALM_ID=$SANDBOX_REALM_ID,$COMMON_ENV" \
  --set-secrets "DATABASE_URL=$DATABASE_SECRET" \
  --quiet

RUNTIME_URL=$(gcloud run services describe "$CANARY_RUNTIME_SERVICE" \
  --project "$PROJECT_ID" \
  --region "$REGION" \
  --format='value(status.url)')

gcloud run services add-iam-policy-binding "$CANARY_RUNTIME_SERVICE" \
  --project "$PROJECT_ID" \
  --region "$REGION" \
  --member "serviceAccount:$RUNTIME_INVOKER_SERVICE_ACCOUNT" \
  --role roles/run.invoker \
  --quiet >/dev/null

QUEUE_RESOURCE="projects/$PROJECT_ID/locations/$REGION/queues/$CANARY_QUEUE"
gcloud run deploy "$CANARY_DISPATCHER_SERVICE" \
  --project "$PROJECT_ID" \
  --region "$REGION" \
  --image "$IMAGE" \
  --service-account "$DISPATCHER_SERVICE_ACCOUNT" \
  --ingress internal \
  --no-allow-unauthenticated \
  --concurrency 1 \
  --max-instances 1 \
  --set-env-vars "PHASE8B_SERVICE_MODE=task_canary_dispatcher,PHASE8B_QUEUE_RESOURCE=$QUEUE_RESOURCE,PHASE8B_PROVIDER_RUNTIME_URL=$RUNTIME_URL,PHASE8B_RUNTIME_INVOKER_SERVICE_ACCOUNT=$RUNTIME_INVOKER_SERVICE_ACCOUNT,PHASE8B_CANARY_TASK_ID=$CANARY_TASK_ID,$COMMON_ENV" \
  --set-secrets "DATABASE_URL=$DATABASE_SECRET" \
  --quiet

CANARY_QUEUE_STATE=$(gcloud tasks queues describe "$CANARY_QUEUE" \
  --location "$REGION" \
  --project "$PROJECT_ID" \
  --format='value(state)')
CANARY_CONCURRENCY=$(gcloud tasks queues describe "$CANARY_QUEUE" \
  --location "$REGION" \
  --project "$PROJECT_ID" \
  --format='value(rateLimits.maxConcurrentDispatches)')
if [ "$CANARY_QUEUE_STATE" != "PAUSED" ] || [ "$CANARY_CONCURRENCY" != "1" ]; then
  printf '%s\n' "Canary queue did not converge to PAUSED/concurrency=1" >&2
  exit 1
fi

printf '%s\n' "$CANARY_QUEUE"
