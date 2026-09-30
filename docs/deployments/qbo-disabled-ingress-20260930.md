# QBO disabled-ingress deployment record

## Approved boundary

On 2026-09-30 the operator approved and deployed the reviewed disabled-ingress plan: **11 creates, 0 updates, 0 deletes**, with an estimated incremental low-traffic cost of USD 20-25/month, not a spending cap. Hosted CI1514 passed for the deployment-record head `6c5ae5ed27eb64d293c8679fb1f261da3aa703d0` before apply.

PR #448 remains draft and unmerged. A subsequent narrow approval authorized only logging-normalization correction and one DNS record after a no-change plan. Neither approval authorizes Intuit settings, migrations, additional secrets, customer connections, provider processing, brokers, queues, schedulers or synchronization activation. `promotionAuthorized=false`; application model calls remain zero.

## Immutable candidate

Reviewed implementation commit: `3f90f387eca173258c44ae87ff98e477ee225fa5`.
The later logging configuration correction does not change the deployed source or artifact pins.

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

The deployed ingress IP is `136.81.90.78`; Cloud Run revision `qbo-production-oauth-ingress-00001-6lx` is Ready with 100% intended traffic. Complete plans, provenance and operational state are retained in the restricted operator deployment-record directory outside temporary storage. The default Cloud Run hostname returns 404.

After the no-change plan, the separately authorized Cloudflare record was created: A `integrations.vaeroex.com` -> `136.81.90.78`, DNS only, TTL 300. The complete zone list had no conflicting record; no existing record was changed. Authoritative Cloudflare DNS and public resolver 1.1.1.1 both returned that address and TTL. Certificate issuance and public HTTPS disabled-response verification are still pending at this record's commit; the final PR deployment receipt records their actual outcome. Do not bypass TLS or treat pending issuance as working HTTPS.

Production client credential metadata confirms `qbo-intuit-production-client/versions/1` is ENABLED; no value was read. `qbo-intuit-webhook-verifier` has no versions. Neither secret is mounted or accessible through bootstrap runtime configuration.

## Logging normalization

The live Wasm API omits `logConfig` when logging is disabled. The [API default is false](https://docs.cloud.google.com/service-extensions/docs/reference/rest/v1/projects.locations.wasmPlugins#LogConfig); [google 7.39.0](https://github.com/hashicorp/terraform-provider-google/blob/v7.39.0/google/services/networkservices/resource_network_services_wasm_plugin.go) flattens absent/empty objects to no block. An explicit false block therefore caused a perpetual proposed update, not enabled logging.

Only the redundant plugin block was removed. A resource postcondition requires every returned logging entry to be disabled. The attribute remains managed and non-computed: actual remote enablement produces a visible plan change. Backend request logging remains explicitly false. No `ignore_changes`, provider upgrade, live logging mutation, Terraform apply, or state edit was used.

Focused regression `scripts/qbo-callback-logging-provider-tests.cjs` exercises the actual locked provider with a localhost GET-only API and ephemeral import plans, never a deployed state. Omitted and empty logging are no-ops; explicit false remains visible normalization drift; enabled logging is detected as an update from true to no block. All four cases pass. Run with the Terraform binary and installed provider-directory paths as arguments.

The fresh live plan at `2026-09-30T17:32:46Z` exited 0: **0 creates, 0 updates, 0 deletes**. Plan SHA-256: `52d43fe451a05b7625b02483bd6ca609db6e46b540f6aa2e4aed3e495230f4d3`. The deployed state hash before and after remained `d2c31c57fe1a7b609a40c56ac3c1df3c593d80baaafd9c98b16cf4c963dbeb7c`. Both Terraform roots validate; recursive formatting, two bootstrap mock tests, bootstrap 79 assertions, QBO Production 236 assertions, scoped ESLint and whitespace checks pass. No broad local run or subagent was launched.

Intended callback: `https://integrations.vaeroex.com/oauth/callback`.
Intended webhook: `https://integrations.vaeroex.com/webhooks/qbo`.
Neither may process provider work in bootstrap mode. Intuit registration and genuine verifier storage remain separate manual/approval gates. If Intuit requires successful endpoint verification before revealing its verifier, stop rather than acknowledge an unverified webhook.

Rollback retains the disabled image/gates. No operational fallback, database rollback or customer-data deletion is part of this scope. Future full-runtime adoption must transfer exact state ownership under an exclusive lock; two roots must never manage these resources simultaneously.
