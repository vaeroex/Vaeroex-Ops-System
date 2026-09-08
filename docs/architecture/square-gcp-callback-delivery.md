# Dedicated Square Sandbox portal — code-only delivery

## Dependency and isolation

This is an explicitly dependent PR from `codex/square-gcp-sandbox-callback` to `codex/square-sandbox-qualification`, at PR #354 head `766832f9496f16b06b218c2c28c63c0ce9a3e631` (tree `c061a86a8977f1b10c8a1980676e334e8fbfd069`). It reuses that unmerged broker/lifecycle correction rather than copying its changes. Both PRs must remain open and unmerged. Do not merge this dependent PR into its base branch as a shortcut: after a separately authorized #354 merge, retarget/reconfirm the dependency and re-run exact-head checks.

The original dirty worktree and its QBO files were not changed. There are no changes to existing provider parsers, contracts, fingerprints, credential adapters, QBO source, database routine bodies or registry/Next route activation. The fixture-rich QBO runner only adds the exact sixth dormant Square migration after its unchanged historical chain; its compatibility assertions remain mandatory.

No remote migration, deployment, cloud configuration, DNS, IAM grant, secret value, live OAuth/API call or real credential access occurred. Migration 107 is a new Git artifact only; PR #354's migration 106 remains an unmerged dependency, not permission to apply either remotely. The explicitly named new branch has Vercel Git deployments disabled; main's deployment behavior is unchanged. CI builds/test scripts have no deployment or migration-to-hosted hooks.

## Implemented behavior

The small same-origin portal runs directly behind guest TLS, outside Vercel/Cloudflare HTTP proxies. Auth is verified server-side against the exact isolated Supabase issuer, and every database operation checks the current session, member, actor, entity and actual broker LOGIN. A host-only, Secure, HttpOnly, SameSite=Lax session cookie holds only the isolated Auth access JWT. No browser SDK, refresh cookie, browser storage, analytics, third-party resources or query-based portal auth is provided. Ordinary form navigation is disabled; fixed hash-pinned script/fetch preserves exact Origin plus CSRF and no-referrer.

Only this callback invocation's successful atomic `consume_state` commit arms its first-consent closure. Current generation/row version, initiating session, state expiry, provider revocation and host approval are checked again across waits and before the encrypted credential commit. Local disconnect never revokes the provider grant. Successful verified consent stops at `authorized_unmapped` (the customer projection calls this `mapping_required`); there is no mapping/enrollment/refresh/webhook/ingestion interface and economics remain blocked.

The native adapter verifies a Google-signed full Compute identity against pinned host/service-account metadata. The DB bootstrap uses a separate disposable identity and only the dedicated broker-secret version; OAuth application-secret access remains closed until consumed intent. First consent permits one secret read and one encryption to the explicit SOFTWARE KMS version 1; decrypt and refresh are absent. No ADC, CLI, environment-token, WIF or service-key fallback is installed.

Callbacks always use no-store/no-referrer and a fixed queryless clean redirect. No receipt is needed because portal and receiver are the same origin; no code/state/error/description is forwarded to Vercel or persisted. The accepted browser-managed navigation and inaccessible cloud-host diagnostic residual risks are unchanged and are not represented as proof of zero recording. Known request logs, app logs, traces, dumps, swap/suspend or configured capture still block hosted qualification.

## Validation and review evidence

- Native identity/first-consent credentials: **2,309 synthetic assertions**; independent rerun passed. Actual local RSA signatures and mocked fixed Google endpoints, exact version/protection negatives, replay/abort/late completion and bounded responses.
- Portal/real Chromium/native TLS/overload: **697 assertions**. Fresh private browser, actual loopback TLS and canonical-host resolver; no hosted requests. Sign-in, connect, callback, clean authorized_unmapped view, local disconnect/logout, real wire Origin/no-referrer, session-only cookies, malformed/duplicate/pre-handler cleanup, stalled-body cancellation, TLS SAN/key/expiry negatives, two active requests/third rejected and 12-request burst rejection.
- New real-PostgreSQL suite: **241 assertions**. Actual separate LOGIN, complete 107-migration chain, joined portal/service/persistence synthetic consent, no enrollment/tasks/provider revoke, revocation/session/NOLOGIN/expiry lock waits and lost-COMMIT-ACK recovery. Google-native composition and Auth issuer are separately mocked; no hosted end-to-end claim.
- Existing real-PostgreSQL suites: durable **581 assertions / 226 scenarios**; lifecycle **442 / 67**, including fresh Chromium; remote binding **160 / 75**; broker/runtime **234**. Historical SQL/ACL and QBO fingerprints remain exact.
- Ops: **87** synthetic/loopback assertions; Terraform 1.16.1 + Google 8.1.0 formatting/schema validation and **9 mocked-provider cases**. No real cloud plan/apply.
- Existing integration parser/security/architecture suites passed, including unchanged remote credentials **2,623**, architecture **224**, optimized handoff/Chromium **656** and QBO compatibility. Typecheck, lint (59 pre-existing warnings; zero errors), repository security group and optimized application/native bundle builds passed locally. The packaged executable also passed the isolated outside-repository launch smoke checks.
- Required exact-head GitHub `verify` and `security-database` remain delivery gates. The complete pgTAP/Docker SQL corpus and unchanged Go/Terraform QBO gates are verified by that CI job, not claimed from the macOS native database harness. No live Vercel check is requested because deployment is prohibited.

Coordinated implementation was followed by cross-review of code authored by other agents and one fresh independent full integration review. Concrete corrections were applied for exact zone/ACME mount alignment, certificate SAN/key/full-window validity, SDK transport-failure logging containment, explicit KMS SOFTWARE version-1 encryption, and standalone executable packaging. The bundle smoke test caught a false ncc `require.main` guard and missing external `server-only` package; the dedicated entry and exact pinned dependency are now exercised from a copied release outside the repository. Independent re-review found no remaining material defect. Final review includes overload/early-callback cleanup, packaging and documentation; the PR's final commit/tree and exact CI run are the authoritative delivery anchors, not a self-referential hash in this file.

## Remaining hosted gates and approved cost envelope

[The finite checklist and cost table](square-gcp-callback-qualification.md) distinguish passed local portions of gates 1–9 from pending resource-dependent portions and gates 10–12. The current $20/month pre-tax approval covers the proposed roughly **$17.18 at 730 hours / $17.50 at 744 hours**, including the existing key/secret baseline and modeled use. It is not a provider-enforced hard cap. The whole-project alert template uses $10/$15/$18/$20 thresholds and must be configured and delivery-tested before hosted qualification. Finite one-hour/manual-start windows, 100 sensitive opens, 10 initiation attempts, bounded concurrency and aggregate monthly review supplement alerts; counters are not durable billing controls.

The proposed resources are one e2-small/10-GiB standard disk/IPv4, isolated network/firewall, dedicated DB-secret metadata/version, existing Sandbox KMS/app-secret/keyless broker references and budget alerts. No new KMS version, runtime/webhook capability, LB/NAT/registry/paid DNS or paid resource outside that envelope is included. Provisioning is not performed by this code delivery. The next action request must itemize actual resources, budget channels and delivery test, operator access, dated OS/Node/Certbot versions, host ID, exact least-privilege grants, isolated DB LOGIN/approval and migration chain, DNS/TLS, and a hosted **synthetic-only** window. Missing IDs/approvals remain null/closed; none were invented.

Real secret delivery, remote migrations, deployment/configuration and hosted tests require the next explicit execution instruction and direct provider-controlled entry where needed. Live OAuth needs a separate explicit readiness authorization after hosted privacy evidence; retention/disposition remains unresolved. Production activation, QBO changes and full source-ingestion Sandbox qualification are not authorized or delivered.

## Exact dependent file manifest — 50 files

Relative to the pinned PR #354 head (not relative to main):

```text
.github/workflows/ci.yml
docs/architecture/square-gcp-callback-delivery.md
docs/architecture/square-gcp-callback-qualification.md
lib/integrations/control-plane/square-gcp-callback-contracts.ts
lib/integrations/control-plane/square-gcp-callback-credentials.ts
lib/integrations/control-plane/square-gcp-callback-database.ts
lib/integrations/control-plane/square-gcp-callback-identity.ts
package.json
scripts/external-integrations-architecture-regression-tests.js
scripts/external-integrations-square-gcp-callback-credentials-regression-tests.js
scripts/package-square-gcp-callback.js
scripts/run-phase8b-zero-based-delivery-migration-tests.js
scripts/run-square-account-connection-qualification.js
scripts/run-square-broker-runtime-qualification.js
scripts/run-square-durable-page-qualification.js
scripts/run-square-gcp-callback-database-qualification.js
scripts/run-square-gcp-callback-portal-qualification.js
scripts/run-square-remote-sandbox-qualification.js
scripts/square-dormant-scope-test-support.js
services/square-sandbox-callback/config.example.json
services/square-sandbox-callback/infra/.gitignore
services/square-sandbox-callback/infra/.terraform.lock.hcl
services/square-sandbox-callback/infra/README.md
services/square-sandbox-callback/infra/main.tf
services/square-sandbox-callback/infra/outputs.tf
services/square-sandbox-callback/infra/tests/sandbox.tftest.hcl
services/square-sandbox-callback/infra/variables.tf
services/square-sandbox-callback/infra/versions.tf
services/square-sandbox-callback/ops/99-square-callback-privacy.conf
services/square-sandbox-callback/ops/README.md
services/square-sandbox-callback/ops/acme-bootstrap.mjs
services/square-sandbox-callback/ops/certbot-deploy-hook.sh
services/square-sandbox-callback/ops/coredump.conf
services/square-sandbox-callback/ops/host-policy.example.json
services/square-sandbox-callback/ops/host-preflight.mjs
services/square-sandbox-callback/ops/instance_configs.cfg
services/square-sandbox-callback/ops/renew-certificate.sh
services/square-sandbox-callback/ops/run-ops-qualification.mjs
services/square-sandbox-callback/ops/vaeroex-square-acme-bootstrap.service
services/square-sandbox-callback/ops/vaeroex-square-callback.service
services/square-sandbox-callback/ops/vaeroex-square-certbot.service
services/square-sandbox-callback/ops/vaeroex-square-certbot.timer
services/square-sandbox-callback/src/auth.ts
services/square-sandbox-callback/src/config.ts
services/square-sandbox-callback/src/entry.ts
services/square-sandbox-callback/src/portal.ts
services/square-sandbox-callback/src/runtime.ts
services/square-sandbox-callback/src/server.ts
supabase/migrations/20260908042529_square_gcp_callback_authority.sql
vercel.json
```
