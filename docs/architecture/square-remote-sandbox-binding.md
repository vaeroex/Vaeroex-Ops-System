# Isolated Square remote Sandbox preparation

Status: **code-only, disabled and unwired; not deployed, activated or provider-qualified**. Base main is `985da4fa9464bd31d0cc51ad50e8b7204bc720b9`. The original dirty QBO worktree is excluded. This record supplements, and does not complete or authorize, the [Sandbox approval worksheet](square-sandbox-approval-worksheet.md).

The latest authorization permits repository implementation, synthetic credentials/injected mock providers, local database tests, independent review and an open unmerged PR. It explicitly forbids further mutations of the already-qualified Sandbox database, real credential access, cloud provisioning, deployments, Square calls/configuration and route/ingestion/registry/economic activation. Earlier infrastructure instructions do not override this narrower delivery boundary.

## Confirmed database and installed baseline

The user confirmed the exact project reference despite different display names in the original request:

| Field | Verified value |
| --- | --- |
| Project reference | `oysjpoondtcrqpghhrbd` |
| Project display name | `vaeroex's Project` |
| Organization display name | `vaeroex-square-sandbox` |
| Organization identifier | `tababxipszvofsszhrkc` |
| Plan / region | Free / `us-west-2` |
| Database | PostgreSQL 17.6, ACTIVE_HEALTHY |

The Free choice supersedes the earlier paid Micro authorization. No paid project, upgrade or add-on was created. Data API is enabled, automatic table exposure is disabled, automatic RLS is enabled, and GitHub auto-deployment is disconnected. The database is independent of Production `mdiianhfrojmxqpwrflh`, Preview `zfpnhvcmuuvtswttmnjd`, and QBO `khneunqbekrqspzafaey`; none of those targets was migrated.

On 2026-09-07, the canonical **104-file** migration chain was installed from zero, through `20260907174326_square_dormant_account_connection.sql`, using the pinned Supabase CLI 2.111.0 and its authenticated temporary login. No database password was requested or read. The link was checked against the exact approved project reference immediately before dry run and push. Seeds and custom-role installation were excluded. No fixture platform or synthetic customer data was installed remotely.

- Ordered filename list, LF-delimited SHA-256: `0046a1ee63eedb23d3529055b03274e5c04bcad159ec38ab1b4a697fd93b65e1`.
- Ordered raw SQL concatenation SHA-256: `fbad65e10b141ff2b3b21fffc28c33659cd6022a57141ba87a7f8b22c9b1b487`.
- Remote ledger: exact 104 version/name match, no missing or duplicate versions, 2,665 recorded statements. Canonical timestamps are preserved; MCP-generated replacement timestamps were not used.
- Installed routine bodies match all 41 canonical Square routines and the QBO dormant-gate routine.
- Database size after installation: 28,388,499 bytes (about 27.1 MiB).
- All 83 public tables have RLS. All 19 Square private tables have FORCE RLS and no direct customer/service/runtime table privileges.
- All 11 Square public checked functions use fixed empty search paths and exclude `anon`, `authenticated` and `service_role`. Four Square capabilities remain NOLOGIN/NOINHERIT with no runtime membership provisioned.
- Square configuration, synthetic qualification gates, connections, enrollments, tasks and cursors are all empty. Generic integration connections and enabled QBO runtime configurations are empty. The QBO Production gate trigger remains enabled.
- Private cursor validation retains 4,096 characters and 1–3,600-second retention; QBO contracts were not changed.

Security advisors reported no RLS-off tables or Square function-exposure warnings. Inherited findings were 88 informational no-policy notices and 22 generic SECURITY DEFINER warnings (existing core/managed endpoints). Performance notices were 213 unindexed foreign keys, 306 unused indexes, 17 auth-initplan warnings and 10 multiple-policy warnings. No unrelated policies, grants or index changes were made. See [database advisor explanations](https://supabase.com/docs/guides/database/database-linter).

The additive remote-binding migration in this branch is **not part of that installed baseline** and is not remotely applied until reviewed and qualified.

## Free-tier compatibility and operational limits

No required paid Supabase feature was identified for a small bounded qualification: full PostgreSQL transactions, actual LOGIN roles, RLS, checked functions, `pgcrypto`, `vector`, Auth, and shared IPv4 pooling are supported. The canonical installation itself verified the required extension/schema compatibility. No PITR, replica, branching service, SAML, custom Supabase domain or log-drain feature is required.

Free has 500 MB database capacity, shared compute and inactivity pausing. The per-connection logical source cap is not a physical database-wide cap: row/index overhead, immutable history and concurrent connections also consume capacity. A real run must use explicitly bounded fixtures/concurrency and remeasure total database size. This is compatibility evidence, not a performance qualification. A missing capacity feature requires stopping, not an automatic upgrade. [Free plan](https://supabase.com/pricing), [compute and disk](https://supabase.com/docs/guides/platform/compute-and-disk).

Automatic exposure being disabled means `authenticated` has no SELECT on `profiles`, `workspaces` or `workspace_members`. The dedicated operator path must not rely on ordinary workspace-context queries or introduce blanket table grants. Auth verification and the checked backend membership/session boundary remain separate. Default Auth email delivery is restricted; do not disable confirmation or reuse Production SMTP to work around it. [API security](https://supabase.com/docs/guides/api/securing-your-api), [Auth SMTP restrictions](https://supabase.com/docs/guides/auth/auth-smtp).

## Dormant remote host authority components

The only intended host is `https://square-sandbox.vaeroex.com`, in a distinct Vercel project named `vaeroex-square-sandbox`. Vercel's target named `production` means this isolated project's stable alias, not Square Production. Existing project `prj_J810bZ9ECoN4CyLKujUoEEH8N6ja` and `www.vaeroex.com` remain forbidden. Arbitrary preview URLs are not approved hosts.

The binding requires all of the following, not merely a hostname or environment switch:

1. Exact Sandbox host, database reference, application ID `sandbox-sq0idb-9K0xgcatxe0ABuUmkSNjFw`, API `2026-08-19`, and Sandbox endpoint.
2. Cryptographically verified Vercel deployment identity bound to the approved team/project/environment.
3. A private owner-approved database record returned by a no-argument checked function, restricted to actual dedicated LOGINs. Four independent request-owned clients must agree on that binding.
4. A current approved test operator, active workspace management membership and Business Entity, finite policy/approval expiry, and matching account configuration. The existing per-action live-session and generation checks remain authoritative.
5. Separate verified seller/location mapping and explicit enrollment for ingestion. A host binding cannot manufacture provider evidence, revive a generation, authorize economic contributions or register Square.

The additive migration creates no configuration row, LOGIN, membership, secret, mapping, task or activation. The local-only synthetic qualification path continues to reject Vercel/Production. Missing identity, policy or runtime composition leaves routes closed. The approval function takes shared locks and checks wall time after lock waits; request transactions recheck the binding alongside existing checked RPCs.

## Pending secure setup and cost review

No dedicated Vercel project, deployment, DNS record or Square console setting has been created by this implementation. Creation must add no paid commitment; deployments/builds and runtime usage must also fit the permitted cost boundary. No paid add-on, new seat, KMS infrastructure or secret service may be provisioned implicitly.

No environment values are copied wholesale from Production. Non-secret settings will identify only the approved isolated host, Supabase project, Square Sandbox application/API and closed gates. Database LOGIN secrets, any public Auth key entry and approved credential references must use provider-owned secure inputs without assistant readback. No environment download is needed or authorized.

Before any real OAuth callback, separately verify upstream query-log suppression, HTTPS and callback handoff privacy. Configure the Square Sandbox redirect only after the deployed receiver is verified. Register only `oauth.authorization.revoked`, and only after secure signature-key storage and exact-URL signature verification. Leave all Production Square settings unchanged.

Still unresolved: approved test operator/workspace/Business Entity, dedicated LOGINs, exact secret/KMS/WIF references and authority, finite test source-retention/approval expiry, later verified seller/location mapping, callback log suppression, and eventual retention/revocation/purge decisions. Private cursors remain capped at one hour; sources remain pending; economics and automatic purge remain disabled. No final Production retention value or app-wide revoke authority is inferred.

Real Square calls, consent, refresh, revocation, ingestion and sandbox qualification are not authorized by this preparation record. The [worksheet](square-sandbox-approval-worksheet.md) remains the acceptance and cleanup checklist.

## Code-only enrolled credential adapter

`createSquareRemoteSandboxEnrolledCredentials` implements the existing broker's secret-store and KMS interfaces without changing the broker, envelope or AAD contracts. Construction requires an exact checked binding, an immutable Square/Sandbox credential context, an abort signal, **injected** network and deployment-verification functions, and a trusted current-enrollment authority capability. No default constructor supplies these dependencies and the public application never installs this factory.

The authority capability is not a boolean, environment setting or serialized claim. Its future live implementation must consult the checked database boundary using an actual dedicated LOGIN and verify current `oauth_verified` enrollment, workspace/connection/credential/generation, seller/location mappings, policy and retention. This delivery does not implement a live authority bootstrap. Initial consent and webhook-only access do not receive an exception; reviewing their distinct composition remains separately authorized work.

Each operation checks current authority before signing-identity use, before every cloud step and before releasing its result. Changed binding, expired approval, unavailable authority, revoked enrollment or denied IAM closes the adapter. Encryption/decryption require the exact existing canonical AAD (provider, environment, workspace, connection, generation and credential identity) and approved KMS key. Application-secret access requires the exact immutable Secret Manager version and matching Square Sandbox application identity. Foreign provider/environment, workspace, context, resource or changed policy cannot select another tenant's credential. Existing broker leases/CAS still control reads and refresh storage; these injected transports grant no database mutation authority.

The fixed network sequence is signed Vercel identity → Google STS → the approved service account with a requested 300-second token → the approved secret version or KMS key. There are no delegates, arbitrary destination URLs, redirects, ambient credentials, metadata-server/ADC/CLI fallback, automatic retry or shared token cache. Missing references fail before network; real IAM denial is not bypassed. Only synthetic network responses were exercised. [STS contract](https://cloud.google.com/iam/docs/reference/sts/rest/v1/TopLevel/token), [service-account token contract](https://cloud.google.com/iam/docs/reference/credentials/rest/v1/projects.serviceAccounts/generateAccessToken), [Secret Manager access](https://cloud.google.com/secret-manager/docs/reference/rest/v1/projects.secrets.versions/access), [KMS encrypt](https://cloud.google.com/kms/docs/reference/rest/v1/projects.locations.keyRings.cryptoKeys/encrypt).

Resource bounds are derived from the existing interfaces: 131,072-byte maximum ciphertext expands to 174,764 base64 characters; 4,096-byte AAD expands to 5,464. Their fixed request envelope fits below 181 KiB and the conservative **256 KiB wire cap**. Plaintext is at most 32 KiB and decoded application-secret payload at most 64 KiB. A single fixed collector and current chunk replace per-character/per-chunk collections. The UTF-8 string, parsed response and base64 conversion buffers can coexist; total retained memory is bounded by those wire/field limits, not claimed to equal the collector's 256 KiB. Engine object overhead is bounded by the finite JSON input; no unknown response graph is recursively traversed or retained in a cache.

One operation runs at a time, at most 32 per request-owned adapter, within a 60-second lifetime and five-second waits. Cancellation uses one replaceable active wait, not a shared promise that accumulates reactions as chunks arrive. Disposal or failure inside a cloud operation aborts outstanding work and makes the adapter unusable; late completion cannot publish a result. Invalid preflight inputs or a malformed returned secret fail closed without creating authority, even if a later valid operation is attempted. Owned byte buffers are zeroed. Returned private broker objects and unavoidable JavaScript strings remain subject to the existing caller lifecycle; immutable JS strings cannot be reliably erased, and there is no claim of perfect heap zeroization. Errors and object serialization do not reveal synthetic or real secret material.

## Local verification and review history

The preparatory modules and migration were reviewed locally. An earlier permission review paused the Google WIF/Secret Manager/KMS adapter implementation until the user explicitly authorized **code-only implementation and synthetic tests**. The rejected change was not bypassed. That code-only authorization has now been supplied; actual credential access, provisioning, live calls and route wiring/activation remain prohibited. Nothing automatically composes these capabilities into the public application.

Completed evidence before the credential-adapter addition (rerun affected suites and final repository CI for delivery):

- All 22 Square regression commands passed, including unchanged parser/request/descriptor/registry fingerprints. The final remote suite has 222 assertions covering signed Function identities, exact database/project mixing, fixed RPC transactions and actual OAuth-provider request shapes through a synthetic network.
- New SQL qualification: 133 assertions / 74 scenarios through the complete baseline plus additive migration in an owned disposable local cluster. Rollback/retry preserves non-Square/QBO and existing Square routine/ACL fingerprints. Actual four-LOGIN and forged SET ROLE cases, forced RLS, default-closed state, per-field policy denials and all four lock-wait expiry boundaries passed.
- Replacing `clock_timestamp()` with `transaction_timestamp()` only in a second disposable test copy reproduced failure at the intended post-lock expiry assertion. The repository migration was not modified by that mutation test.
- Combined durable qualification: 573 assertions / 226 scenarios. Supported maximum Catalog witness committed in 11,312 ms, including 8,521 ms in its SQL commit; these are local observations, not Free-tier latency guarantees.
- Account/database/browser qualification: 435 assertions / 67 scenarios, including authenticated connect, cross-site callback cookies, mapping, checked pending ingestion, local disconnect, denial, same-seller reauthorization, and history/referrer/console privacy. This uses synthetic provider responses and fresh local browser profiles, never the user's signed-in browser.
- TypeScript, optimized application build, security regression chain, architecture checks (176 assertions), whitespace and ESLint passed. ESLint retains the existing 59-warning budget.

Independent review found and the implementation corrected the standard Vercel Function-token lifetime (two hours, not one) and the existing OAuth token-status contract (`POST` with a null body). [Current Vercel OIDC reference](https://vercel.com/docs/oidc/reference#standard-openid-connect-claims). The supported Catalog timing also exposed an overly short five-second database commit timeout; only the fixed atomic-commit RPC now receives a bounded longer timeout, without extending the existing lease or removing final SQL expiry checks.

The fixed atomic-page operation uses 20-second SQL / 21-second client query timeouts, then resets SQL timeout to five seconds and rechecks the full current host binding inside the transaction before COMMIT. The post-execution check prevents a host approval that expires during page execution from publishing the page. Its focused regression asserts rollback/no COMMIT after valid preflight followed by expired approval. Ordinary control queries retain their five-second SQL / six-second client limit. This postflight is specific to atomic pages; applying a general gate after authenticated revocation could incorrectly roll back a successful fail-closed capacity latch. Restoring the old token-status body condition in an isolated in-memory module reproduces the intended provider-flow failure.

Independent bounded re-review found no remaining material issue in those corrected modules. Final reviewed database-adapter SHA-256: `8a5a450d09b3ccbffc71517e132aebffbf41a1e2204644b49993d010134450af`; focused regression SHA-256: `ec1242cae241f833e57d58f219d7da0b2a71de5808fb37dae0a797b29a1c830a`; new migration SHA-256: `773003624dd030a20a1398860667f67431a3ee087d67fac5ce90c4d78487656a`. This is not final exact-tree or unfinished-composition clearance.

Public Production verification remained HTTP 200 for the homepage and HTTP 404 for Square callback, webhook and settings routes. Existing Square parsers, request limits, registry, QBO source and canonical migrations have no diff. Original dirty-worktree tracked diff SHA-256 remains `d3881ac2e1aa97ed503bb28a96dee680c4b9a7ec69736c86c9e541b1ea5610b2`.

The prior preparation ended without a commit, push or PR. The live Sandbox ledger was verified at the canonical 104 entries; the new approval migration remains repository-only and must not be applied remotely under the current authorization. No deployment, DNS change, Square configuration, resource provisioning or added recurring resource cost is part of this code-only delivery.

## PR deployment exclusion

`vercel.json` disables Git-triggered deployment for the exact branch `codex/square-remote-sandbox-binding`. There is no wildcard rule or change to `main` or other branches, and no Vercel dashboard/environment mutation. This avoids a Preview deployment when the authorized PR is pushed. The architecture suite checks the entire configuration exactly. GitHub's `verify` and `security-database` jobs remain required for this delivery; a Vercel deployment/check is deliberately not requested. [Vercel branch deployment contract](https://vercel.com/docs/project-configuration/git-configuration#git.deploymentEnabled).

## Code-only delivery verification

The final credential suite passes **2,623 assertions**, including actual existing-broker refresh through synthetic WIF/Secret Manager/AES-GCM KMS responses, exact AAD isolation, missing/revoked authority, IAM denial, malformed/cross-resource replies, secret redaction, exact plaintext/ciphertext/wire boundaries, one-byte/large chunks, cancellation/late completion, 32 operations, the 60-second lifetime and five-second wait expiry. No test uses a default network. The binding suite passes 222 assertions and architecture passes 187; all 38 registered non-database external-integration regression commands passed. TypeScript, the application build, the complete security chain and ESLint (the unchanged 59-warning budget) passed locally.

Independent credential review found and corrected an eager-dependency cancellation race: an injected dependency could abort synchronously and return a rejected promise before a handler was attached. The corrected wait installs cleanup before invoking a thunk and always observes rejection; regressions cover authority, identity and network variants. It also corrected overly strict Secret Manager response-name matching. The exact authenticated approved request remains authority; a numeric project name with the exact secret/version suffix is accepted as a response representation, never as a verified project mapping or subsequent request destination. Foreign textual project names, versions, secret names and malformed paths still deny. This follows the [first-party Secret Manager resource parser](https://github.com/firebase/firebase-tools/blob/master/src/gcp/secretManager.ts).

Credential-adapter source SHA-256: `2bad4d254f5ab0fae2437c7886df7b7ef1993ba433d08869b1e63982e3e1fc6b`; focused test SHA-256: `32b3aebee5161203ecaa16484c1154bcf8f740a6ae8cbe3d3405458b84001d3f`. The independently reviewed implementation received only a final comment clarification that the collector cap is not total heap. Final exact-head CI status belongs in the delivery PR, not an unearned claim in this pre-push record.

Local SQL/browser checks were rerun using a clean copied context, no linked metadata, `env -i`, an owned native PostgreSQL 17 cluster and a fresh synthetic browser profile: remote binding **133 assertions / 74 scenarios**, combined durable **573 / 226**, account/browser **435 / 67**, including all eight browser scenarios. The largest supported Catalog witness committed in 11,589 ms in this rerun; this is an observation, not a remote performance guarantee. The fixture-rich QBO upgrade gate remains mandatory in CI: this host lacks Docker/local Supabase and pgTAP, so that exact gate is not claimed as locally rerun. Executed local qualifications preserved the existing Square and QBO/non-Square definitions and ACLs.

### Exact 22-file delivery manifest

The complete branch scope includes the previously prepared dormant binding and its code-only credential adapter; no temporary Supabase link metadata is included.

```text
.github/workflows/ci.yml
docs/architecture/square-production-readiness.md
docs/architecture/square-remote-sandbox-binding.md
lib/integrations/control-plane/square-customer-routes.ts
lib/integrations/control-plane/square-remote-sandbox-auth.ts
lib/integrations/control-plane/square-remote-sandbox-contracts.ts
lib/integrations/control-plane/square-remote-sandbox-credentials.ts
lib/integrations/control-plane/square-remote-sandbox-database.ts
lib/integrations/control-plane/square-remote-sandbox-deployment.ts
lib/integrations/control-plane/square-remote-sandbox-transport.ts
package.json
pnpm-lock.yaml
scripts/external-integrations-architecture-regression-tests.js
scripts/external-integrations-square-remote-credentials-regression-tests.js
scripts/external-integrations-square-remote-sandbox-regression-tests.js
scripts/run-phase8b-zero-based-delivery-migration-tests.js
scripts/run-square-account-connection-qualification.js
scripts/run-square-durable-page-qualification.js
scripts/run-square-remote-sandbox-qualification.js
scripts/square-dormant-scope-test-support.js
supabase/migrations/20260907225626_square_remote_sandbox_binding.sql
vercel.json
```

## Remaining actions requiring separate authorization

1. Merge the reviewed PR. This delivery must leave it open and unmerged.
2. Apply the new binding migration to the exact isolated Sandbox, provision constrained database LOGINs and configure owner-approved binding records. No setup SQL or approval row runs during build/CI/deployment.
3. Approve exact secret versions, KMS key, IAM/workload-identity/service-account resources and their costs; provision them and enter secrets through provider-owned screens. Existing Production/QBO credentials cannot be copied or reused implicitly.
4. Approve the real test operator/session, workspace and Business Entity, finite source retention/version/fingerprint/expiry, one-hour-or-shorter private cursors, revocation access policy and capacity handling. Do not infer final Production retention or any historical purge authority.
5. Review and authorize future live host composition and first-consent handling. Authentication/consumed OAuth state precedes seller verification; existing verified enrollment is mandatory for ingestion credential use and must never be invented to bootstrap consent. The current adapter remains unwired, and synthetic permissions are not live authority.
6. Approve creating the dedicated Vercel project, secure non-Production configuration, deployment, DNS and HTTPS setup after cost review. Revisit this branch's deployment exclusion only with that authorization; never change the existing Production project's database or settings.
7. Verify callback query-log suppression at every upstream boundary, secure Auth/session configuration and payload-free observability; then separately configure the Sandbox redirect and exact-URL signed revocation webhook with secure signature-key storage.
8. Authorize bounded Sandbox consent, exact provider calls, synthetic seller/location fixtures and explicit mapping/enrollment before any real qualification or ingestion. The unexplained Production token count is not authority. Local disconnect is not grant-wide revocation; any provider-wide exercise needs explicit grant-level authority and impact approval.
9. Production registration, live ingestion/scheduling, economics/reconciliation, Production activation, purge and later-phase work remain separately authorized milestones. Passing synthetic or Sandbox tests does not grant them.
