# Disabled QBO ingress bootstrap

This is an independently plannable **ingress-only** stage for PR #448. It reuses
the permanent QBO runtime image, ingress service mode and shared callback edge.
It is not provider activation or a replacement credential/security architecture.

## Fixed boundary

Project `vaeroex-qbo-prod-20260827`, region `us-central1`, hostname
`integrations.vaeroex.com`. The only inputs are the reviewed source commit and
two published immutable image digests. There are no secret, database, KMS,
broker, queue, scheduler, DNS, provider-account or execution-enable inputs.

The runtime entry selects `QBO_INGRESS_BOOTSTRAP_ONLY=true` **before importing**
the operational server. Bootstrap rejects operational QBO/database configuration,
does not consume request bodies or inspect secret headers, logs no request
material, and returns `503 qbo_production_processing_disabled` for every request
except exact `GET /health`. Health is liveness only and explicitly reports both
processing gates and provider readiness false. The unchanged public edge may
reject malformed requests before they reach the disabled handler; it does not
expose the backend's health path publicly.

The ingress identity has no project roles, secret access or KMS access. Cloud Run
has no secret mounts and no VPC attachment, scales to zero, and is limited to one
1-vCPU/256-MiB instance. The Invoker IAM check is disabled only for public ingress,
with internal/load-balancer-only ingress and the default URL disabled. This is
Google's supported domain-restricted-sharing pattern, not an organization-policy
exception. Private operational service modes retain their IAM checks.

## Expected resources

Exactly 11 creates: one ingress service account, one Cloud Run ingress service,
one global ingress address, managed certificate, serverless NEG, backend service,
URL map, HTTPS proxy, forwarding rule, Wasm plugin and edge extension. No public
IAM binding is created. Existing NAT address `34.134.226.250` and its VPC/subnet/
router are not managed by this root. This address is **not** the ingress IP.

The common `../modules/callback` is used by this root and the full runtime root.
The full root includes explicit move declarations for its nine formerly inline
edge resources. Moving their source location does not change their remote names.

## Review and plan

Use the existing pinned Google 7.39.0 lockfile, and retain its verified checksums.
Initialize the local backend with an explicit protected state path outside Git.
Use an operator access token only in the child process environment, never as a
Terraform variable or command argument. Saved inputs/plans contain identifiers
and image digests only, never secret values. Keep plan/state/CLI credentials and
`.terraform` outside the committed release artifacts.

Run the focused bootstrap tests and bundle smoke, existing QBO Production
regressions, Terraform format/validate and the plan-only mock tests. Publish
images only from an exact clean commit archive, not the working directory.
Review the actual saved plan with `scripts/qbo-ingress-bootstrap-plan-check.cjs`;
it rejects anything other than the 11 allowed creates. Plan qualification is
not approval to apply. An absent DNS record leaves the certificate provisioning;
the Terraform apply must not be represented as working HTTPS before DNS and TLS
are separately verified.

## Later gates, not part of this apply

1. Apply only the approved saved bootstrap plan, verify default URL/alternate
   host denial and disabled processing, then separately authorize DNS to the
   resulting **global ingress** IP and wait for certificate `ACTIVE`.
2. Manually register the exact Intuit Production webhook endpoint
   `https://integrations.vaeroex.com/webhooks/qbo` with reviewed subscriptions.
   Do not claim `200` acceptance while signature verification is unavailable.
3. Enter the verifier through the private Terminal helper into the existing
   Secret Manager container; inspect only numeric-version metadata.
4. Separately review broker/signature-verification deployment and OAuth readiness.
   No connection, provider call, queue or scheduler is enabled by this stage.

Before the full root can manage ingress, transfer its 11 exact resource addresses
from bootstrap state to full state under an exclusive operator lock, with both
states backed up and plans reviewed. The service and account map keys and shared
module addresses already match. Do not run both states as owners; do not destroy
bootstrap resources or use `-target` to work around missing full-runtime inputs.
The full root must use these exact permanent ingress names. Its existing NAT
foundation ownership is reconciled separately, never duplicated or replaced.

Rollback keeps this disabled image and processing boundary. Do not fall back to
an operational image without the same disabled entry. No database rollback,
credential rotation or customer-data deletion belongs to this scope.
