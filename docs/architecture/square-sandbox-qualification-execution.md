# Isolated Square Sandbox qualification execution

Status: **database preparation complete; live qualification not yet started**.
Repository baseline: `03525f197aa56c6bb0a97710b838ef470b654d27`.
This record reports performed actions separately from approved but unfinished work.

## Current authorization

The user authorized isolated Sandbox setup and bounded provider qualification, including one dedicated software KMS key with exactly one active version and two dedicated Secret Manager versions. Expected fixed charges are approximately USD 0.06/month for the key and at most USD 0.12/month for the two secret versions if the shared free allowance is exhausted; bounded cryptographic usage is authorized at USD 0.03/10,000 operations. No additional fixed-cost resource, version rotation, Production/QBO reuse, automatic purge or immutable-history deletion is authorized.

Test policy: approval valid for 30 days from activation; source-retention authorization 30 days; private cursors at most one hour; pending/untrusted sources and blocked economics. These values are not yet installed and no activation timestamp has started. Production retention/purge choices remain unset. Provider-controlled secret entry and user consent must occur without assistant readback.

## Applied database change — 2026-09-08 UTC

Only project `oysjpoondtcrqpghhrbd`, organization `tababxipszvofsszhrkc` (`vaeroex-square-sandbox`), region `us-west-2`, was linked and changed. It reported ACTIVE_HEALTHY, PostgreSQL 17.6, and the dashboard showed Nano compute and no GitHub repository connection. The previously confirmed Free plan was not changed.

The pinned Supabase CLI 2.111.0 used its existing authenticated temporary-login path; no password was requested, supplied in commands, or read. Before push, the exact linked project reference and live project identity were checked. The dry-run contained exactly `20260907225626_square_remote_sandbox_binding.sql`, no seeds and no custom roles. The canonical file SHA-256 was `773003624dd030a20a1398860667f67431a3ee087d67fac5ce90c4d78487656a`.

That one reviewed migration was applied with its original version/name. A subsequent dry-run reports no pending migrations. No history repair, replacement timestamp, direct application DML, runtime grant or enrollment was used.

| Evidence | Result |
| --- | --- |
| Complete ledger | 105 entries, latest `20260907225626`, 2,674 statements |
| Final ordered filename SHA-256 | `c3a5d680c57574c96419f5ce084acb6892cb53023d78a75b3ea91f3f86565594` |
| Original 104 statement-record fingerprint, unchanged before/after | `fe00238f6043d9927fb510ca86a12c8018219eebeeedb7b3760547c09fe1a6fc` |
| Original 41 Square canonical routine-body fingerprint | `e129f67f22843d878fc0e2b64266a6f53a381bd9a7168fca9a220d4d79f433d6` |
| Original 41 routine definitions/owners/ACL/config metadata, unchanged | `51d57d69732a90de95723d078c48ec3cbfcd74870975deaf8bac6756ef6b8b3f` |
| Final 42 Square routines plus QBO dormant-gate canonical bodies | 43 routines, `216a32fc39e84b10b8e5a04f2dbb510db31c29230654842b707ce9ccab986d1b` |
| New binding routine body | `f04547ee2c4c389c094d5c969a866b7fd4d8c3e51c2ca36ae6da00d0c52c4e65` |
| Public table RLS | 83/83 |
| Private Square tables | 20/20 RLS and FORCE RLS; all 20 tables empty |
| New table/routine ownership | `postgres`; routine SECURITY DEFINER, empty search path, no arguments, JSONB result |
| New checked function EXECUTE | Broker, verified-enroller and runtime capabilities only, plus owner; no PUBLIC/anon/authenticated/service-role exposure |
| Direct new-table privileges | Denied for all four Square capabilities and ordinary API roles |
| Existing capabilities | Four NOLOGIN/NOINHERIT roles; roles/memberships unchanged |

Seven before/after catalog hashes matched: non-Square functions, relations, constraints, non-internal triggers, policies, roles and memberships. This verifies QBO/non-Square schema compatibility inside the isolated database; no Production/QBO database was queried or migrated. The original dirty worktree remains outside this branch.

The management query role was denied EXECUTE with SQLSTATE `42501`. This is negative access evidence only, not qualification through a dedicated runtime LOGIN. Those LOGINs have not been created. The local disposable harnesses were not pointed at the hosted database.

Security advisors returned 89 informational no-policy notices and the same 22 inherited warnings. The new informational notice is expected for the private FORCE-RLS table with no direct application grants. No Square function exposure was found; no broad RLS policy or grant was added to silence the advisory. [Advisor explanation](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).

## Not yet performed

No WIF provider, Vercel deployment, DNS record, Square callback/webhook configuration, OAuth consent, seller/location mapping, provider record or live ingestion has been created by this run so far. The isolated Google Cloud project, one approved software KMS key/version, the user-entered application-secret version, two keyless service accounts and an empty dedicated Vercel project were subsequently created as recorded below. No secret value was accessed by the assistant. Existing Production web/database/Square settings, Production token count and QBO were not changed.

Google Cloud CLI 578.0.0 project inventory stopped because the existing operator session requires reauthentication. Its previous browser-login attempt was stopped after the user reported an unexpected profile switch and a 404; neither the 404 nor its URL was used as authentication evidence. The user enabled two-step verification directly. The original controlled browser now loads the authenticated Console successfully, while the CLI still reports a separate reauthentication requirement. No session state, token, authorization code or secret was exported.

The Console's All-projects listing for organization `vaeroex.com` (`1061441228384`) showed the Document Worker, disposable Phase 8B and QBO Production projects, but no Square Sandbox project. The first submission was rejected by tool safety review pending exact-target approval; no alternate creation path was attempted. The user then explicitly approved display name `Vaeroex Square Sandbox`, immutable project ID `vaeroex-square-sandbox`, and organization `1061441228384`, preserving the existing cost ceiling.

Creation then succeeded in the controlled Console. Its completion notification and new project welcome page verified project ID `vaeroex-square-sandbox`, project number `112579468800`, and organization `vaeroex.com`. No other project was modified. Selecting the software symmetric version price in the Cloud KMS Console listing showed USD 0.06/month; the default external-key price was not used. At that stage, no key, version, access grant or billing upgrade had been submitted.

The Secret Manager API listing displays Google Cloud Platform terms. Its replica-storage pricing shows USD 0.06 per version/month above the six-version shared allowance. The Sandbox project's Billing navigation resolved to the existing `My Billing Account`; after an initial page-load failure and one retry, it displayed `Paid account`. No billing account was created, upgraded or changed by this run. Enablement initially paused for action-time confirmation of the displayed terms; the user subsequently expressly authorized both APIs.

The user clicked Cloud KMS Enable directly. Although its Marketplace button remained stale, the completed operation notification identified `cloudkms.googleapis.com` in `Vaeroex Square Sandbox`, and the API/Service Details page at `/apis/api/cloudkms.googleapis.com/metrics?project=vaeroex-square-sandbox` explicitly reported `Status: Enabled`. No second enable request was submitted. Secret Manager's direct service-status lookup instead returned the disabled library page; the coordinator clicked Enable exactly once. The resulting `/apis/api/secretmanager.googleapis.com/metrics?project=vaeroex-square-sandbox` page explicitly reported `Status: Enabled`. No additional terms screen or provider error appeared. Only Secret Manager was enabled by the coordinator in this step; no unrelated API enable action, key/secret creation, credential access, project switch, or IAM change was performed. Both service-status pages were left available in the controlled browser.

### KMS creation and first secure-entry handoff

After the user's renewed provisioning instruction, the old Console tab continued redirecting KMS management to its already-enabled API listing. A refreshed tab and Console navigation did not resolve it; one fresh tab in the same controlled browser loaded the actual empty key-ring inventory. No API was toggled and no security setting was relaxed. A read-only CLI metadata attempt still required reauthentication, so no CLI write was attempted.

The coordinator created key ring `square-sandbox` in `us-west1`, then key `oauth-credentials` with generated software material, symmetric encrypt/decrypt purpose, Google symmetric algorithm and rotation `Never (manual rotation)`. The final versions table contains exactly version `1`, `Enabled & primary`. Creation was shown as 2026-09-07 18:25 local time. The resource is `projects/vaeroex-square-sandbox/locations/us-west1/keyRings/square-sandbox/cryptoKeys/oauth-credentials`, with version suffix `/cryptoKeyVersions/1`. No import, additional version, automatic rotation, encryption/decryption call or key-material access occurred. The provider-default 30-day scheduled-destruction delay was left unchanged; no destruction was scheduled. This consumes only the approved approximately USD 0.06/month key-version allowance.

The key's Permissions view showed only the operator's inherited Owner role from the exact Sandbox project. No Production/QBO or application service-account grant was present in that view, and no new IAM grant was made. This is not a claim of isolation from project/organization administrators or of completed workload IAM qualification.

Secret Manager's empty inventory was verified. The `square-sandbox-application` creation form was prepared with manual replication only in `us-west1`, Google-managed at-rest encryption, no rotation notifications, no expiration/automatic deletion, and an empty value. The user then entered the application-secret payload privately and confirmed successful creation. Metadata-only inspection verified exactly version `1`, `Enabled`, created 2026-09-07 18:37 local time, resource `projects/112579468800/secrets/square-sandbox-application`. Overview confirmed user-managed replication only in `us-west1`, no scheduled rotation, no notifications, no expiration and no version aliases. Permissions showed only the operator's inherited Sandbox-project Owner role; no application access was granted. This is not isolation from administrators. The stored payload was not opened or validated by the assistant. Runtime configuration must use the immutable text-project-ID reference `projects/vaeroex-square-sandbox/secrets/square-sandbox-application/versions/1` and fail closed on any payload mismatch.

The webhook version remains pending its exact Square-generated subscription signature key and reviewed loader; no placeholder version is permitted. No real credential value is to be returned to the assistant.

### Keyless identity preparation

The exact Sandbox project's service-account inventory was empty before creation. The coordinator created `vx-square-sandbox-broker@vaeroex-square-sandbox.iam.gserviceaccount.com` (unique ID `114364535512720213941`) and `vx-square-sandbox-webhook@vaeroex-square-sandbox.iam.gserviceaccount.com` (unique ID `117651183953726294112`) using Create and close, skipping both optional permissions steps. The final inventory shows exactly these two accounts, both Enabled and No keys. No project role, service-account impersonation principal, resource-access grant or user-managed key was added. Resource-scoped IAM and exact Vercel workload trust remain pending; creating an identity is not evidence of completed authorization.

Vercel metadata confirmed the existing team `team_uORtrMvad77Qz6HikOgD4cnp` / `vaeroex-2167s-projects` on Pro and, before creation, only the forbidden Production project `prj_J810bZ9ECoN4CyLKujUoEEH8N6ja`. Published limits permit unlimited Pro projects; this is not a promise of zero usage charges. The coordinator installed the pinned CLI `59.11.7`, inspected its help and checked existing authentication using a noninteractive output-suppressed request. No authentication file, token or environment value was opened.

The exact `project add vaeroex-square-sandbox --scope vaeroex-2167s-projects --non-interactive` command succeeded from `/private/tmp`, outside either repository. Readback confirms new dedicated project `prj_P6ZpicJIn1CB1apsuYlQ87plQr7C`, name `vaeroex-square-sandbox`, exact approved team and `link: null`. Its deployment inventory contains zero deployments. No Git import, environment copy, deployment, plan change, member seat or paid add-on was requested. The new project is not a qualified live host; reviewed composition, callback privacy, workload trust and database authority remain prerequisites.

The project IAM inventory, including Google-provided role grants, showed only the operator's existing project Owner and inherited Organization Administrator. Neither new service account received a broad project role. A Workload Identity Federation form is prepared but **not saved**: pool `square-sandbox` initially Disabled, provider `vercel-square-sandbox`, issuer `https://oidc.vercel.com/vaeroex-2167s-projects`, single audience `https://vercel.com/vaeroex-2167s-projects`, subject mapping `assertion.sub`. Its condition requires the exact owner slug/ID, project name/ID above, target `production`, and subject `owner:vaeroex-2167s-projects:project:vaeroex-square-sandbox:environment:production`. The Vercel target label is not Square Production. No pool, provider, impersonation grant, Secret Manager accessor grant or KMS grant has been saved. Access-changing browser actions require action-time confirmation before submission.

Future access must be scoped to the exact single workload subject on the dedicated service accounts, never the entire pool or project. Only the broker may receive the exact application-secret version and the exact KMS CryptoKey. Only the webhook identity may receive its later exact signature-key version. No runtime/enroller cloud secret access, user-managed keys, project Editor/Owner, token-signing privilege, delegates or Production/QBO principal is part of the planned grant. The shared Vercel project subject covers trusted builds as well as runtime and cannot establish per-route isolation. The pool must remain disabled and the host unwired until the remaining security and authority preconditions are met.

The remote `main` reference remains `03525f197aa56c6bb0a97710b838ef470b654d27`. The original dirty worktree's tracked binary diff still hashes to `d3881ac2e1aa97ed503bb28a96dee680c4b9a7ec69736c86c9e541b1ea5610b2`; it was not edited.

Prerequisites still include live first-consent authority distinct from the enrolled-only adapter, bounded webhook-secret composition, remote handler installation, business-read transport/runtime, actual dedicated LOGINs and verified operator/workspace/entity binding. Separate Google service accounts do not establish per-route process isolation when they share one Vercel OIDC subject; the deployment must not claim otherwise. Upstream callback query-log privacy must be proven with non-secret canaries before real consent. No authority or resource boundary may be weakened to enable the test.

Coverage plan: 25 operation/projection paths over 16 unique operations; eight unique pageable operations. Provider-real cursors and outcomes must be distinguished from controlled fault injection. No fabricated pagination, provider ordering, cleanup or economics evidence is permitted.

### Local correction and test evidence — not remote qualification

The distinct-LOGIN preflight exposed a concrete mismatch: the broker's credential-read branch called a helper requiring the configured runtime's `session_user`. The new additive migration `20260908014713_square_broker_runtime_credential_authority.sql` preserves the existing runtime helper and changes only the account function's credential-read helper invocation. The new private helper uses the owner-approved Sandbox binding and configured runtime, preserving task/lease/generation/retention/mapping checks without granting broker runtime, page-write or direct-table privileges. Independent review found session expiry after a scan-lock wait; the correction now repeats the existing configuration/session check after that wait. A two-connection regression proves denial without retained read evidence, and removing that check only in a temporary test copy reproduces failure.

The focused suite passed 118 assertions on disposable PostgreSQL 17.6, including the exact original 105-migration failure, rollback/retry, decryption through the existing broker, foreign contexts, lease/version CAS, policy changes, actual session/host expiry during lock waits, reauthorization and disconnect. Independent re-review resolved the session finding and verified the sole existing account-function substitution. No new migration has been applied remotely.

The three historical database runners retain their original migration/rollback assertions, then install only their remaining explicit tail before lifecycle tests. The complete 106-migration local suites passed: durable 577 assertions / 226 scenarios; account 440 / 67 including eight fresh-profile browser scenarios; binding 158 / 75; focused broker 118. Non-Square/QBO definitions, ACLs and upgraded immutable history are checked across the new tail. The managed Supabase CI and fixture-rich QBO job remain separate gates, not claimed by these native PostgreSQL runs.

All 23 existing non-database Square suites passed with unchanged parser/request/descriptor/registry fingerprints. TypeScript passed; lint passed with the existing 59 warnings and no errors. These passes do not establish real OAuth, live credentials, remote least-privileged database access, provider logging privacy, or Sandbox qualification.

The complete repository security-check group and optimized Next.js 15.5.21 application build also passed with an empty inherited environment apart from the executable path. No Production environment file was copied. Exact-head GitHub `verify` and `security-database` remain required separately. The current branch is explicitly disabled in Vercel's Git deployment configuration, in addition to the existing remote-binding branch exclusion; this does not change main's deployment behavior or create a Sandbox deployment.

The actual optimized Next server exposed a second integration defect: its configured global headers replaced the handoff's route-level CSP and no-referrer policy. The correction preserves the global rule and adds a strict fixed-script-hash override for the three Square handoff paths. Dynamic, already-validated navigation values are HTML-escaped inert attributes rather than executable script interpolation. Independent review rejected an initial exclusion approach because Next custom headers match case-insensitively while routes do not; the final approach also protects genuine case-variant 404s. It preserves non-Square/QBO/neighbor effective headers in both global CSP modes.

The final header qualification passed 656 assertions across five optimized Next 15.5.21 builds and fresh Chromium checks. It reproduces the original override and rejected exclusion defects, validates nine genuine Next case-variant 404s, checks exact wire bytes, and exercises real DOM decoding/navigation, no-referrer and an altered-script CSP negative control. Only synthetic loopback fixture entry requests are allowed; all destination requests are aborted. The final timeout-corrected runner passed, and independent re-review found no remaining material findings. This does not claim persistent browser-history erasure, behavior after JavaScript failure/crash, or upstream query-log privacy.

The account suite was rerun against the final fixed-hash implementation: 440 assertions / 67 scenarios including all eight fresh-browser scenarios passed again. Affected route regressions passed 207 assertions, remote Sandbox integration 222, and architecture 193. Final independently reviewed SHA-256 values are:

| Artifact | SHA-256 |
| --- | --- |
| Broker/runtime migration | `deaa435457f7e9d4ce7368344c232e7ee5217c7b9b17477d19ca0a27cecd0d93` |
| Broker/runtime focused runner | `bdc9487dbdb92344eb538bae8fb55326a1461a57f4186f0b6f29af2f886372ff` |
| Customer routes | `596beb547dee2647d07ac74d6e67280c18ed53114e2e402736b1f3da8cb4c9b1` |
| Shared fixed-script policy | `916dfd0e702514d837b2909837b2f841220caa707a0c3c622ddf12a9f440dc6a` |
| Next configuration | `ab9707ea1b885652c1281f96d314492fa1fc81321c5257f539901dfea8b1a663` |
| Optimized header/browser runner | `cc250ec388bfd821a8dac16b9e627b4580d89d7980e12dc0e36ac25bc13e6157` |

Independent review also verified that the three historical database-runner tail changes preserve their original rollback/retry assertions and QBO/non-Square checks. The final code has no unresolved material review finding; unresolved live-host prerequisites remain explicit below.

### Delivery manifest and remaining stop conditions

The correction delivery is limited to these 17 files:

1. `.github/workflows/ci.yml`
2. `docs/architecture/square-sandbox-qualification-execution.md`
3. `lib/integrations/control-plane/square-customer-handoff-policy.json`
4. `lib/integrations/control-plane/square-customer-routes.ts`
5. `next.config.mjs`
6. `package.json`
7. `scripts/external-integrations-architecture-regression-tests.js`
8. `scripts/external-integrations-square-connection-routes-regression-tests.js`
9. `scripts/run-phase8b-zero-based-delivery-migration-tests.js`
10. `scripts/run-square-account-connection-qualification.js`
11. `scripts/run-square-broker-runtime-qualification.js`
12. `scripts/run-square-durable-page-qualification.js`
13. `scripts/run-square-handoff-header-qualification.js`
14. `scripts/run-square-remote-sandbox-qualification.js`
15. `scripts/square-dormant-scope-test-support.js`
16. `supabase/migrations/20260908014713_square_broker_runtime_credential_authority.sql`
17. `vercel.json`

The new migration is local/code-review work only; the hosted ledger still has 105 migrations. Merging a correction into Git, applying it to the isolated database, provisioning dedicated database LOGINs, and enabling a reviewed host are separate operations. This delivery does not perform or imply any of them. The code PR must remain unmerged pending separate authorization.

Real consent must not start until callback URL privacy is demonstrated at the actual hosted ingress/logging boundary with non-secret canaries and positive controls. Vercel documents request search parameters in runtime-log details; a clean final browser address, `history.replaceState`, a no-referrer response and payload-free application logs alone do not establish removal from upstream logs or persistent browser history. No real authorization code or state may be used to investigate this requirement. [Vercel runtime-log details](https://vercel.com/docs/logs/runtime#log-details).

The prepared disabled workload trust must not be confused with an enabled grant. Saving federation or adding access requires the exact target and principal to be reconfirmed at the provider action. The host must stay unwired while the live composition and privacy prerequisites above remain unresolved. The second secret version requires direct user entry of the exact Sandbox subscription signature key; no value is to be generated as a placeholder or read back by the assistant.
