# QBO disabled-ingress deployment record

## Approved boundary

On 2026-09-30 the operator approved only the previously reviewed disabled-ingress plan: **11 creates, 0 updates, 0 deletes**, with an estimated incremental low-traffic cost of USD 20-25/month, not a spending cap. Deployment is pending verification and hosted checks when this record is committed.

PR #448 remains draft and unmerged. This approval does not authorize DNS or Intuit settings, migrations, secret population, customer connections, provider processing, brokers, queues, schedulers or synchronization activation. `promotionAuthorized=false`; application model calls remain zero.

## Immutable candidate

Reviewed implementation commit: `3f90f387eca173258c44ae87ff98e477ee225fa5`.
This documentation-only descendant does not change the reviewed source or artifact pins.

| Artifact | Immutable reference |
| --- | --- |
| Runtime | `us-central1-docker.pkg.dev/vaeroex-qbo-prod-20260827/qbo-production/runtime@sha256:f9ad1882dceed3dfd321be260dfb18280684f7877db4f6a93d102acf31fbe780` |
| Wasm callback edge | `us-central1-docker.pkg.dev/vaeroex-qbo-prod-20260827/qbo-production/callback-edge@sha256:dd1b768df3ce9d90d76c74311a35d600e2a8f3c5021828ef25088a7eba484c9e` |

Both registry revision labels match the implementation commit. Successful Cloud Build IDs: runtime `a9c11f54-7caf-4027-96f3-a2b949b7d00a`; edge `9e893f6d-3414-4da5-93fc-70c737a15da9`.

Approved saved Terraform plan SHA-256:
`358aff60018b8406d9f30385bfb4dbb7001be9805093a60433080a1797feb6ac`.

Terraform 1.16.1; locked Google provider 7.39.0. Root: `services/external-integrations-qbo/infra/bootstrap`. The binary plan, source bundle and operational state are retained separately in a restricted operator directory, never in Git. A fresh read-only comparison must match the approved actions and configuration before applying the original saved plan. Scope drift is a stop condition.

## Exact resources

Project: `vaeroex-qbo-prod-20260827`; region: `us-central1`; hostname: `integrations.vaeroex.com`.

| Type | Name | Operation |
| --- | --- | --- |
| Service account | `qbo-oauth-ingress` | Create |
| Cloud Run | `qbo-production-oauth-ingress` | Create |
| Global external address | `qbo-production-callback-ip` | Create |
| Managed SSL certificate | `qbo-production-callback-cert` | Create |
| Serverless NEG | `qbo-production-callback-neg` | Create |
| Backend service | `qbo-production-callback-backend` | Create |
| URL map | `qbo-production-callback-url-map` | Create |
| HTTPS proxy | `qbo-production-callback-https-proxy` | Create |
| Global forwarding rule | `qbo-production-callback-https` | Create |
| Wasm plugin | `qbo-production-callback-edge` | Create |
| Edge extension | `qbo-production-callback-extension` | Create |

No existing foundation resource is imported, replaced or altered. Regional outbound IP `34.134.226.250` is not the ingress IP and must not become the callback DNS destination.

## Fail-closed behavior

Only `QBO_SERVICE_MODE=oauth_ingress`, `QBO_INGRESS_BOOTSTRAP_ONLY=true`, and the implementation source SHA are supplied. The disabled entry runs before loading the operational server. It returns 503 for OAuth/webhook processing without reading bodies, secret headers or query values, and without database, Secret Manager, KMS, token, broker or persistence operations. Exact local GET `/health` is liveness only and reports both processing gates false; the existing edge does not expose this health route publicly.

Cloud Run uses internal/load-balancer-only ingress, disables its default URL, and scales from zero to one instance. The public ingress Invoker IAM check is disabled using Google's domain-restricted-sharing-compatible pattern; private operational service modes retain IAM enforcement. No allUsers binding or organization-policy change is authorized. The ingress account has no project-role/secret/KMS grant. Existing edge host/query validation, fail-closed execution and disabled request logging remain intact. No dummy verifier or signature exception is introduced.

## Verification and follow-up

Prior targeted checks: bootstrap 79 assertions; built-bundle smoke 12; QBO Production 236; two Terraform mock tests; both Terraform validations; real-plan allowlist; scoped lint/compilation; Go edge/plugin tests; artifact builds; whitespace checks. Required hosted CI runs on the pushed descendant; no additional broad local runs or subagents are authorized.

After authorized apply, retain the complete state outside temporary storage and publish a sanitized receipt identifying actual resource counts, ingress IP, revision/digests, readiness and disabled-response observations. A certificate pending DNS is not working HTTPS. Do not weaken ingress or replace the certificate merely to obtain a health result.

Next DNS proposal, not permission to execute: create a DNS-only A record for `integrations.vaeroex.com` pointing to the newly allocated global ingress IPv4, then wait for the managed certificate to become ACTIVE. Confirm existing A/AAAA/CNAME/CAA and DNS-provider behavior before changing records. Do not use the outbound NAT address.

Intended callback: `https://integrations.vaeroex.com/oauth/callback`.
Intended webhook: `https://integrations.vaeroex.com/webhooks/qbo`.
Neither may process provider work in bootstrap mode. Intuit registration and genuine verifier storage remain separate manual/approval gates. If Intuit requires successful endpoint verification before revealing its verifier, stop rather than acknowledge an unverified webhook.

Rollback retains the disabled image/gates. No operational fallback, database rollback or customer-data deletion is part of this scope. Future full-runtime adoption must transfer exact state ownership under an exclusive lock; two roots must never manage these resources simultaneously.
