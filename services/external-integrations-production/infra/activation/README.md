# Production Integration Platform activation

This directory is the deployable, reviewed activation layer for the shared Vaeroex Production Integration Platform. It is pinned to Google Cloud project `vaeroex-integrations-prod`, project region `us-west1`, and the exact Production host `square.vaeroex.com`. The existing provider-neutral composition contract remains the authority for shared-resource and cross-provider isolation.

## Safety state

The first apply must leave both `bootstrap_image_digest = null` and `callback_edge_image_digest = null`. It creates the shared network, static ingress and egress addresses, NAT, task queue, image repository, bounded logging, Cloud Armor policy, Square-specific identities, one KMS key, and empty Secret Manager containers. It creates no Cloud Run service, load balancer, callback edge, DNS record, secret version, database LOGIN, database grant, or migration.

After the bootstrap and Square callback-edge images are built and independently verified, a second reviewed plan may pin both immutable Artifact Registry digests. They must be supplied together. The fail-closed edge validates the exact callback shape, removes the query before Cloud Run request logging, forwards only bounded internal handoff headers, drops provider denial descriptions, and passes only exact queryless health/webhook traffic. The edge extension explicitly forwards only the method, path, and undecoded query attributes required by that validator; an omitted attribute must fail validation rather than produce an unusable deployment. Edge and load-balancer request logging remain disabled. The runtime image always returns `404 production_integration_runtime_disabled`; it contains no OAuth, webhook, provider, database, evidence, economics, or AI implementation. All runtime gates are Terraform validations fixed to `false`.

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
10. Independently verify the canonical Production database ledger and existing Supabase Pro backup coverage before applying only the reviewed Square Production foundation migration.
11. Create the exact six LOGIN-to-capability-role bindings using a separately reviewed, password-private operation. Do not grant table access. Deliver each numbered database credential only to its matching secret and identity.
12. Keep Square credentials absent and provider calls, onboarding, webhook intake, evidence, economics and AI dispatch closed until their individual activation gates pass.

The two reviewed release images are already pinned by immutable digest. Direct human build submission is closed: the operator receives neither Cloud Build Editor, permission to act as the builder, nor staging-object creation authority. Any future rebuild requires a separately reviewed repository-bound trigger that obtains source from the protected Vaeroex repository revision and uses the dedicated builder without granting the initiating human arbitrary build authority. Resolve every published artifact to its immutable digest, verify the exact-digest vulnerability result, and update `production.tfvars.example` plus its release-pin regression in the same review. A tag is never a deployable input.

## Excluded

No paid Supabase PITR add-on, extra region, replica, reservation, long-term commitment, AI runtime, Marketplace product, Production Square credential, QBO mutation, or economic activation belongs to this layer.

The budget is an alerting control, not a hard spending cap. Gross usage, promotional credits, and estimated out-of-pocket cost must be reported separately. The current credit is time-limited, so the platform must remain affordable at gross rates after it expires.
