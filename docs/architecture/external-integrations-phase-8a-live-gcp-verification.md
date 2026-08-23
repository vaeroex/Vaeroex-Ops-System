# External Integrations Phase 8A Live GCP Verification

**Status:** Live non-Production verification complete; architecture/security review only
**Date:** 2026-08-22
**Branch:** codex/external-integrations-phase-8a-live-gcp-verification
**Base:** dc1d88bdacd7f25138699660d22e850d6b667857
**Scope:** Isolated synthetic GCP runtime, credential, delivery, and security verification only

## Outcome

The deferred Phase 5 and Phase 6 live-GCP gates passed in a new disposable
non-Production project. The verification used only recognizable synthetic
credentials and data. It did not access Intuit, authorize QuickBooks, call a
provider API, use Production Supabase, change Production Vercel, promote KPI
state, or invoke a model. `promotionAuthorized` remains `false` and the model
call count is `0`.

Phase 8B is safe to authorize for implementation and architecture/security
review. This result does not authorize a real provider credential, Intuit app,
QuickBooks connection, Production integration runtime, or deployment.

## Isolation And Lifetime

| Item | Verified value |
| --- | --- |
| GCP project | `vaeroex-intg-dev-8268` (`660427083395`) |
| Organization | `vaeroex.com` (`organizations/1061441228384`) |
| Billing account | `011B41-...-4FF1` (redacted) |
| Region | `us-west1` |
| Project labels | `environment=development`, `lifecycle=disposable`, `phase=phase8a`, `purpose=runtime-verification` |
| Project lifetime | About 78 minutes, from `2026-08-23T01:34:31Z` to deletion request at about `02:52Z` |
| Supabase branch | `phase8a-live-gcp-8268`, ID `a456d863-0b8d-426d-ade2-e29ce3b36d63`, ref `ljyrmywwmsrcgdxdbebn` |
| Supabase lifetime | About 30 minutes; data-free and non-persistent |

The project belonged to the Vaeroex organization, used an approved billing
account and region, allowed complete project deletion, and had no relationship
to `vaeroex-document-worker` or any Production integration runtime. Organization
policy prohibited service-account key creation and upload. No downloadable or
user-managed service-account key was created.

## Resource Inventory

The disposable GCP project contained only the following verification resources:

- service accounts `vx-intg-ingress`, `vx-intg-broker`, `vx-intg-runtime`,
  `vx-intg-dispatcher`, and `vx-intg-unrelated`, each with zero user-managed
  keys;
- KMS keyring `phase8a-verification` with keys
  `synthetic-oauth-credentials` and `unassigned-oauth-credentials`;
- Secret Manager secret `phase8a-synthetic-provider`, replicated only in
  `us-west1`;
- private Cloud Run service `phase8a-runtime-verifier`, three revisions, and
  latest revision `phase8a-runtime-verifier-00003-lsd`;
- private Cloud Run job `phase8a-iam-probe` and its bounded IAM probe
  executions;
- Cloud Tasks queue `phase8a-runtime-verification`;
- Artifact Registry repository `cloud-run-source-deploy`, its verification
  image, one source bucket, and the Cloud Build executions needed to deploy the
  fixture;
- Google-managed project service agents and the generated default compute
  identity required by those services; and
- Data Access audit-log configuration for KMS and Secret Manager.

No Scheduler job was provisioned. The OIDC-authenticated due-work boundary was
already exercised through Cloud Tasks, and Scheduler must only signal due-work;
it must never perform provider synchronization itself.

The final Cloud Run image digest was
`sha256:96c39afecfb1129523be30e3884f6bec8601c17176d046abf188e2ecd9331053`.
The private service used one CPU, 512 MiB, concurrency `4`, minimum instances
`0`, and maximum instances `1`. The queue used one dispatch per second and one
concurrent dispatch.

## IAM Boundary

| Principal | Narrow authority |
| --- | --- |
| `vx-intg-broker` | `roles/cloudkms.cryptoKeyEncrypterDecrypter` on the exact credential key and `roles/secretmanager.secretAccessor` on the exact synthetic secret |
| `vx-intg-dispatcher` | `roles/run.invoker` on the exact private verification service |
| `isaac@vaeroex.com` | Temporary `roles/iam.serviceAccountTokenCreator` on the broker service account for the verification probe only |
| `vx-intg-ingress` | No KMS, Secret Manager, or Cloud Run invocation authority |
| `vx-intg-runtime` | No KMS or Secret Manager authority |
| `vx-intg-unrelated` | No KMS, Secret Manager, or Cloud Run authority |

Google-managed service agents retained only their generated Artifact Registry,
Cloud Build, Cloud Tasks, Container Registry, Pub/Sub, Cloud Run, and build
roles. No primitive workload role, wildcard secret access, project-wide KMS
role, browser/client credential authority, `service_role` shortcut, or
downloadable service-account key was introduced.

## KMS Verification

The merged Phase 5 adapter encrypted and decrypted a bounded synthetic OAuth
credential envelope using the unchanged canonical V1 AAD bytes. Identical AAD
succeeded. Changed workspace, connection, generation, and provider environment
all failed. Wrong local and live keys failed, and ingress, runtime, dispatcher,
and unrelated service identities each received an IAM denial.

Credential-key version `1` decrypted its historical ciphertext while enabled.
After version `2` became primary, version `1` still decrypted its own ciphertext
until disabled; it then failed, while version `2` continued to pass. The
unassigned negative-test key could not be used by the broker.

KMS Data Access logs recorded broker Encrypt success, broker Decrypt success,
AAD failures, IAM denials, and disabled-key failures. The observed broker totals
were 10 successful Encrypt operations and Decrypt outcomes of 27 success, 28
invalid-AAD, 6 IAM-denied, and 4 disabled-key failures. Each unauthorized
workload identity produced a denied Encrypt audit event.

## Secret Manager Verification

The broker read exact numeric version `2` of
`phase8a-synthetic-provider`. The application contract rejected `latest`, and
no wildcard version IAM grant was present. Version `1` remained readable during
rotation, then failed after disablement while version `2` remained available.
Ingress, runtime, dispatcher, and unrelated identities each received `403`.

Secret Manager Data Access logs contained nine successful broker accesses, one
disabled-version failure, and one IAM denial for each unauthorized workload
identity. No real client secret was created.

## Private Cloud Run And OIDC

The service was private and granted invocation only to the dispatcher. An
unauthenticated direct request returned `403`; a malformed bearer token returned
`401`. A Google-issued dispatcher OIDC token with the exact service audience
succeeded. Wrong-audience and wrong-service-account tasks failed before handler
execution, proving that neither could reach the application boundary.

The IAM probe used the same workload identities and returned:

| Identity | KMS Encrypt | KMS Decrypt | Secret access |
| --- | ---: | ---: | ---: |
| broker, execution `nzjn6` | 200 | 200 | 200 |
| ingress, execution `26m7h` | 403 | 403 | 403 |
| runtime, execution `wjpp7` | 403 | 403 | 403 |
| dispatcher, execution `dsdmg` | 403 | 403 | 403 |
| unrelated, execution `hbtht` | 403 | 403 | 403 |

The verification handler exposed no KMS/Secret Manager path or decryption
oracle. Its runtime identity had no credential authority. Scale to zero was
enabled through minimum instances `0`.

## Cloud Tasks Delivery

Every accepted task body was exactly a V1 object containing only
`protocolVersion` and `taskId`. Authorized Cloud Tasks delivery with a signed
dispatcher OIDC token returned success. Wrong audience returned
`UNAUTHENTICATED`; wrong service account returned `PERMISSION_DENIED`; neither
produced handler logs.

The authoritative queue used `maxAttempts=3`, backoff `2s` to `4s`, one
doubling, maximum retry duration `30s`, one dispatch per second, one concurrent
dispatch, and full queue logging. Temporary negative-auth fixtures used a
five-second maximum retry duration and stopped after six platform attempts.
Application retry delivered exactly three times with retry counts `0`, `1`, and
`2`, then succeeded.

Three pacing tasks started at `02:17:00.045`, `02:17:01.270`, and
`02:17:02.514`; each finished before the next began, proving both configured
rate and concurrency limits. A deliberate first-attempt `503` redelivered the
same task fingerprint and produced one effect. Cloud Tasks name dedupe was not
used as correctness authority; the Phase 6 relational task/effect ledger
remains authoritative.

During setup, an initial fixture assumed full queue/task resource names in the
Cloud Tasks headers. Current Google documentation specifies short names. The
fixture was corrected and redeployed before the authoritative test set. An
initial probe job launcher path was likewise corrected before the final IAM
executions above. Neither setup correction changed repository authority or the
security result.

## Provider Runtime And Database

The complete canonical migration chain through
`20260822035335_external_integrations_phase_8a0_provider_contract_convergence.sql`
was applied in order to the data-free disposable Supabase branch. No new
migration was created and no migration was applied to Preview or Production.

The merged provider-read path proved that the checked broker can receive and
decrypt a synthetic access token transiently. A refresh token never crossed the
provider-read execution boundary. Near-expiry credentials returned
`refresh_required`; stale generation/version, disconnected or deleted
connection, provider mismatch, and environment mismatch failed closed.
Concurrent ordinary reads remained compatible, while refresh retained its
exclusive lock and compare-and-swap coordination.

The provider-source authority derived workspace, Business Entity, connection,
mapping, provider, and environment from trusted task state. It committed only
an immutable `provider` source version with `untrusted_external_input` trust and
`pending` validation. Direct paths to accepted canonical facts, reconciliation
outcomes, contributions, deterministic aggregates, KPIs, or AI remained absent.

Environment tests accepted `synthetic/test` and represented
`quickbooks_online/sandbox` and `quickbooks_online/production`. QBO `test`,
`development`, `preview`, and `unknown` all failed as authoritative provider
environments. `unknown` remains parsing-only.

The live KMS/provider adapter harness passed 22 assertions. The Phase 8A live
repository contract suite passed 45 assertions.

## QBO Webhook Readiness

Current official Intuit documentation requires the Base64-encoded HMAC-SHA256
of the exact raw request body, keyed by the environment-specific verifier token,
to match `intuit-signature`. Verification must occur before JSON parsing or
side effects. The added contract enforces a two-MiB raw-body bound, strict
Base64 handling, constant-time digest comparison, and fail-closed verification.

After authenticity succeeds, the body digest and minimized event identity feed
the Phase 6 immutable webhook-event/replay ledger. Duplicate or out-of-order
delivery therefore cannot bypass relational replay authority. No webhook route
was deployed or registered, and no Intuit resource was accessed.

Reviewed sources:

- <https://developer.intuit.com/app/developer/qbo/docs/develop/webhooks/configure-webhooks>
- <https://developer.intuit.com/app/developer/qbo/docs/develop/webhooks/best-practices>
- <https://blogs.intuit.com/2025/11/12/upcoming-change-to-webhooks-payload-structure/>

## Leakage And Audit Evidence

Five recognizable synthetic canaries covered access token, refresh token,
original and rotated client secret, and authorization code shapes. Each canary
had zero matches across GCP logs, repository content, sanitized command output,
and error output. Audit logs contained resource names, identities, methods, and
status codes but no credential plaintext. All local canary, result, and
temporary CLI files were removed.

## Regression Record

The external integration repository suites passed 1,735 assertions:

| Suite | Assertions |
| --- | ---: |
| Phase 0 contracts | 109 |
| architecture | 68 |
| Phase 1 | 69 |
| Phase 2 | 53 |
| Phase 3 | 364 |
| Phase 4 | 163 |
| Phase 5 | 86 |
| Phase 6 | 130 |
| Phase 7 | 562 |
| Phase 8A.0 | 86 |
| Phase 8A live | 45 |

Phase 3 retained randomized seed `1514020902` and the reviewed `2` versus
`10,000` performance fixture. The exact registered database gate passed all 518
assertions, including every hosted `dblink` concurrency tail:

| Database suite | Assertions |
| --- | ---: |
| authorization/security | 31 |
| billing | 28 |
| Phase 1 | 48 |
| Phase 2 | 52 |
| Phase 3 | 50 |
| Phase 4 | 116 |
| Phase 5 | 48 |
| Phase 6 | 88 |
| Phase 8A.0 | 57 |

HIGH/adversarial/medium security, authentication, billing, platform evidence,
Evidence Engine, KPI/target/snapshot, intelligence, Business Health,
lifecycle/deletion, workspace agreement, manual activation, legal,
pre-checkout, public positioning, Trust Center, and admin regressions all
passed. TypeScript passed. ESLint completed with zero errors and the existing 59
warnings. The production build passed with 69 static pages. `git diff --check`
passed.

An exploratory sweep of every SQL fixture also encountered one obsolete,
unregistered document-extraction fixture that expects an older dispatch schema.
It is not part of the registered CI/database gate and is unrelated to Phase 8A;
the exact required 518-assertion gate was rerun afterward and passed. This is a
non-gating maintenance observation, not a provider-runtime authority failure.

## Cost And Cleanup

The default Micro Supabase branch rate implies a conservative one-hour charge
of about `$0.01344`. The short GCP run used small scale-to-zero fixtures and
well under free-tier operation thresholds. Estimated incremental total cost is
about `$0.014`, with a conservative upper bound below `$0.05` depending on the
billing account's monthly free-tier consumption.

Cleanup completed as follows:

- the disposable Supabase branch was deleted; the parent branch list contained
  only its original main branch afterward, and the deleted ref refused a new
  database connection;
- temporary database test roles were absent before branch deletion;
- the one temporary Supabase CLI access token created for this verification was
  revoked, while all pre-existing account tokens remained untouched;
- the GCP project deletion request succeeded and lifecycle state was verified
  as `DELETE_REQUESTED`, scheduling the project and every child resource above
  for deletion;
- Google may continue to resolve cached child-resource metadata during its
  project recovery window, but no resource was retained for use and no workload
  remains intentionally active; and
- all local synthetic canary, CLI-home, and result files were removed.

No disposable resource would benefit enough from retention to justify an
exception. A later Phase 8B live test should create a fresh isolated environment
or obtain explicit approval before retaining one.

## Remaining Gates

No Phase 8A live-GCP blocker remains. Phase 8B still requires separate explicit
authorization and review. Real Intuit application registration, provider
credentials, sandbox OAuth, realm connection, API access, webhook registration,
customer UI, Production runtime, and deployment all remain deliberately absent
and unauthorized.
