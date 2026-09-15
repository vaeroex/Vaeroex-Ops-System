# Production Integration Platform activation

This directory is the deployable, reviewed activation layer for the shared Vaeroex Production Integration Platform. It is pinned to Google Cloud project `vaeroex-integrations-prod`, project region `us-west1`, and the exact Production host `square.vaeroex.com`. The existing provider-neutral composition contract remains the authority for shared-resource and cross-provider isolation.

## Safety state

The first apply must leave `bootstrap_image_digest = null`, `callback_edge_image_digest = null`, and `callback_edge_source_commit = null`. It creates the shared network, static ingress and egress addresses, NAT, task queue, image repository, bounded logging, Cloud Armor policy, Square-specific identities, one KMS key, and empty Secret Manager containers. It creates no Cloud Run service, load balancer, callback edge, DNS record, secret version, database LOGIN, database grant, or migration.

After the bootstrap and Square callback-edge images are built and independently verified, a second reviewed plan may pin both immutable Artifact Registry digests. They must be supplied together. The fail-closed edge validates the exact callback shape, removes the query before Cloud Run request logging, forwards only bounded internal handoff headers, drops provider denial descriptions, and passes only exact queryless health/webhook traffic. The edge extension explicitly forwards only the method, path, and undecoded query attributes required by that validator; an omitted attribute must fail validation rather than produce an unusable deployment. Load-balancer request logging is explicitly disabled. Wasm activity logging is omitted because the Network Services API defaults it to disabled and the provider does not round-trip an explicit disabled block; a plan must therefore remain converged without that block. The runtime image always returns `404 production_integration_runtime_disabled`; it contains no OAuth, webhook, provider, database, evidence, economics, or AI implementation. All runtime gates are Terraform validations fixed to `false`.

Google's managed `LbEdgeExtension` invokes only `REQUEST_HEADERS`; its Proxy-Wasm
`endOfStream` callback flag is not a reliable body-presence signal. The edge
therefore rejects every observable callback body indicator from the complete
bounded forwarded header map: `Transfer-Encoding` or `Expect`, any nonzero
`Content-Length`, and duplicate `Content-Length` all fail closed. The header-only
extension cannot itself prove that an HTTP/2 or HTTP/3 client omitted an
indicator-free DATA frame. The downstream OAuth handler must not read a GET
body and must reject one if its runtime exposes one; the currently pinned
disabled bootstrap never reads request bodies. An absent body indicator or one
canonical zero `Content-Length` can proceed to the exact GET/path/query parser.

The OAuth and webhook services disable the Cloud Run Invoker IAM check only while retaining `INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER`. This is Google Cloud's supported public-load-balancer pattern for organizations with domain-restricted sharing. No `allUsers` IAM binding is created, and direct internet access to the generated `run.app` host remains rejected by the ingress restriction. Broker, scheduler, runtime, and evidence services retain the Invoker IAM check and internal-only ingress.

Secret Manager grants are provider- and runtime-specific and are conditional on exact version `1`. Terraform never creates or reads a secret version. Credential delivery, database LOGIN creation, migration application, DNS, and activation are separate checked operations.

## Required order

1. Confirm billing account and promotional-credit eligibility read-only.
2. Confirm the USD 150 gross-spend budget and 50/75/90/100 percent notifications.
3. Run `terraform fmt -check -recursive`, `terraform init -backend=false`, and `terraform validate`.
4. Run `pnpm test:external-integrations-square-production-foundation`.
5. Create a saved plan with `bootstrap_image_digest = null`; inspect every resource and cost-bearing effect before applying.
6. Apply the infrastructure-only plan and verify sanitized outputs and IAM policies.
7. Enable the Terraform-managed Container Scanning API before publishing release images. Build the disabled bootstrap and Square callback-edge images from the reviewed Git SHA, run the callback parser/Wasm tests, inspect both digests and vulnerability results, then use only those immutable digests in a new reviewed plan. Automatic scanning is usage-billed per new digest; it is not a fixed monthly resource.
8. Apply the runtime/LB plan while gates remain closed. Configure DNS only after the managed-certificate target is verified.
9. Verify exact TLS host routing, direct Cloud Run denial, alternate-host denial, rate limiting, disabled endpoints, log retention, rollback and alert delivery.
10. Independently verify the canonical Production database ledger and existing Supabase Pro backup coverage. The approved target must end at `20260902191322_qbo_production_dormant_connection_gate`, then apply only the immediately following `20260902191323_integration_production_runtime_foundation.sql` with the migration tool's exact-version bound. The migration is deliberately provider-neutral and self-contained on that verified Production baseline; no later Sandbox-only Square migration is part of this step.
11. A database that already recorded the former all-in-one `20260912190000` migration is a different upgrade path. The retained historical marker keeps its ledger continuous, and the later forward guard must abort if any legacy Square overlay artifact survives. Do not bypass that guard; reconcile such a database only through a separately reviewed additive migration. The verified Production target has not recorded that historical version.
12. Add a separately reviewed Square runtime overlay only after the complete Square lifecycle schema is present and qualified; no Square-specific overlay is part of this foundation migration.
13. Create the exact six LOGIN-to-capability-role bindings using a separately reviewed, password-private operation. Do not grant table access. Deliver each numbered database credential only to its matching secret and identity.
14. Keep Square credentials absent and provider calls, onboarding, webhook intake, evidence, economics and AI dispatch closed until their individual activation gates pass.

The two reviewed release images are already pinned by immutable digest. Direct human build submission remains closed: the operator receives neither Cloud Build Editor, permission to act as the builder, nor staging-object creation authority. The only configured rebuild path is the `vaeroex-production-images` GitHub push trigger. It is bound to `vaeroex/Vaeroex-Ops-System`, exact branch `main`, the three image/build source paths, the checked-in build configuration, the dedicated builder, and mandatory approval. Before source can execute, the approver must confirm the exact Git merge revision and completed repository checks; approval does not grant source upload, build submission, trigger editing, or builder impersonation.

The first build step reads the build and trigger records through a read-only API role and rejects missing approval, storage/legacy-repository/connected-repository source substitution, a foreign trigger, project/location resource, repository, branch, config path, service account, file scope, any GitHub Enterprise override, a nonempty ignored-file or custom-substitution set, and any mismatch between the exact GitHub repository URL, resolved revision, trigger-system tag, and 40-character commit. Images are tagged only with that commit, pushed by the dedicated builder, resolved to immutable digests, and held as non-deployable candidates until the exact regional Google Artifact Analysis vulnerability discovery note (`projects/goog-analysis/locations/us-west1/notes/PACKAGE_VULNERABILITY`) reports success and the complete relevant occurrence set is identical across three bounded reads. Foreign, nonregional, or ambiguous discovery evidence cannot complete the gate. Critical findings, new high findings, any already-reported secret occurrence, incomplete vulnerability scans, unstable results, unreachable scan regions, and the accepted bootstrap exception without its exact source/dependency/compression fingerprints all fail the build. Artifact Registry automatic scanning supplies vulnerability-analysis completion; this trigger does not configure or claim a secret-analysis completion signal. Absence of a `SECRET` occurrence is therefore not evidence of a completed secret scan. Every candidate records `secretAnalysisQualified = false` and `secretAnalysisRequiredBeforeEligibility = true`. The builder can create a unique result only under `release-candidates/<commit>/<build-id>.json`; it cannot read, overwrite, or delete bucket objects.

A candidate record explicitly has `secretAnalysisQualified = false`, `deploymentEligible = false`, `requiresReviewedDigestPin = true`, and `automaticRuntimeRollout = false`. No build step changes Terraform, Cloud Run, load balancing, migrations, credentials, activation gates, or Git. Eligibility therefore still requires an independent exact-digest vulnerability and secret scan review and a separate reviewed PR that updates `production.tfvars.example`, the distinct callback source commit, and their release-pin regressions. That review must reject missing secret-analysis evidence; neither an image tag nor a candidate record is ever a deployable input. The Cloud Build GitHub App must be connected only to this repository before the trigger can be applied; that provider-controlled connection is a separately inspected administrative prerequisite and does not place a GitHub token in Terraform.

## Excluded

No paid Supabase PITR add-on, extra region, replica, reservation, long-term commitment, AI runtime, Marketplace product, Production Square credential, QBO mutation, or economic activation belongs to this layer.

The budget is an alerting control, not a hard spending cap. Gross usage, promotional credits, and estimated out-of-pocket cost must be reported separately. The current credit is time-limited, so the platform must remain affordable at gross rates after it expires.
