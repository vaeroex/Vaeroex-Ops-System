# Focused independent stack review and readiness correction

Reviewed the proposed PR 462 → 464 stack against deployed base `d91be079c7beb0b6f21a4c5e6b451f90ca06e035`, beginning at clean worktree HEAD `9359bb30b2e48f775dcecb666f3a61b571c8adf2`. The principal independent review covered the security implementation (not authored by this reviewer), both original audit migrations, trusted analysis admission, recovery, and the internal-form replay boundary. Root and other agents are concurrently making separately owned closeout changes; this report does not certify those later changes.

## Verified release defect: VXA-007 chronology amplification

**Priority:** release blocker until corrected and qualified. No production corruption is claimed.

`20261005022017_workspace_security_boundaries.sql:261–265` selects the latest active check by caller-writable `created_at` and updates authoritative parent readiness with that status. Existing contributor policies permit authenticated staff check inserts/updates. In an actual native PostgreSQL fixture, staff inserted a `Ready` check dated 2300, then the owner inserted a current `Out of service` check. Parent readiness remained `Ready` and `last_checked_at` remained in 2300. Staff could retime the old check to 2400 and pin it again. This is a new consequence of the privileged readiness projection; it is distinct from the earlier future-KPI concern VXA-023.

Reproduction and results:

- `/tmp/vaeroex-closeout-readiness-ordering.cjs`
- `/tmp/vaeroex-closeout-readiness-ordering.json`

Root authorized a forward correction after reproduction. Created through the Supabase CLI:

- `supabase/migrations/20261005060258_asset_check_server_chronology.sql`
- `scripts/workspace-asset-chronology-database-tests.cjs`

The new trigger stamps authenticated inserts with database time and rejects authenticated changes to existing creation timestamps, including writes through SECURITY DEFINER functions. It has an empty search path and no direct client execution grant. The existing readiness function now excludes future-dated rows when choosing current readiness. Trusted historical backdating, parent locking, role/tenant/entitlement checks, lifecycle recomputation, and atomic rollback remain intact. Original migrations were not edited.

Native PostgreSQL 17.11 qualification: **27/27 checks passed in 0.83 seconds**, including the pre-correction defect, historical check/parent preservation across migration, retained NOT VALID parent constraints, authenticated/definer stamping, immutable dates, viewer/foreign/expired denial, operator exemption setup/revocation without chronology bypass, trusted historical imports, future-only history, archive/hide fallback, two independent concurrent sessions, and injected parent-write rollback. The harness reuses the existing reduced actual-source DDL/RLS fixture and private Unix-socket-only cluster lifecycle, replacing its test body; it does not rerun or relabel the prior 119 checks and does not exercise Auth/PostgREST/Storage HTTP.

Results: `/tmp/vaeroex-closeout-readiness-after.json`. New SQL SHA-256: `a62006fb63a14cf9f018bab292a4b4ecfbcbee555b1bebcf841cdf7732211722`. JavaScript syntax and scoped diff checks passed. Reproduce with:

```sh
WORKSPACE_AUDIT_PG_BIN=/path/to/postgresql17/bin node scripts/workspace-asset-chronology-database-tests.cjs
```

**Historical boundary:** no check timestamps or pre-existing asset statuses are rewritten by the migration. Previously future-derived parent status can remain until a subsequent check/lifecycle mutation recomputes that parent. Before release, inspect aggregate future-date counts and mismatched parent states, then approve any needed targeted recomputation separately. Do not silently rewrite/delete historical checks. Future historical rows remain history; they are excluded while their date is ahead of the database clock.

## Credible concern / root-owned release follow-up: VXA-028 lost acknowledgement

At the reviewed head, `app/app/operations/actions.ts:239–249` always inserts a new form submission and has no durable request identity. The server adapter only delegates, and the client pending state cannot deduplicate after a committed write whose response is lost. Source-level consequence: replaying identical FormData can create a second row. This report does not present that inference as a new persisted replay test; root owns the focused request-ID implementation and native/HTTP proof.

Acceptance guidance: keep a logical request key stable across retries; scope it to workspace/form/actor; persist an exact payload identity and reject a reused key with different content; return a committed winner after ambiguous acknowledgement; allow a separate intentional identical response through a new request key. Native validation, auth/role/entitlement and parent lifecycle must remain enforced on new work. Same-tab click suppression is not a substitute for this contract.

## Original security migration review

No additional verified privilege escalation or tenant regression found in the reviewed original two migrations and their changed callers. Relevant supporting boundaries:

- Entitlement mutation policies remain restrictive; existing role/tenant policies still authorize actual mutations. SECURITY DEFINER trigger paths inspect the original request role and do not trust user metadata. Membership and subscription lookups remain bound to the supplied workspace.
- The two integration summary exclusions are exact SELECT-only forced-RLS projections, with protected private AFTER writers; connection/OAuth INSERT admission remains guarded. Existing actual provider recovery suites are recorded as passed in prior hosted evidence.
- Storage's private definer helper returns only a predicate, keeps an empty search path, checks the original active member and entitlement, and does not grant private-schema usage. Role-sensitive existing Storage policies remain necessary.
- Composite NOT VALID parent FKs prevent new tenant mismatch without deleting old anomalies. Removing the old single-column cascade preserves mismatched historical rows when a foreign parent is deleted. The new chronology probe reconfirms those constraints/history survive the follow-up migration.
- `create_trusted_analysis_run_v1` is service-only; it verifies original service JWT role, live actor membership, supported workflow, bounded object input and entitlement. Its transaction-scoped run/workspace/actor proof cannot be written by clients or reused after return. Existing generation-key 23505 recovery remains protected by the quota mutex.
- Stored slot checks serialize real independent sessions and preserve existing counting policy; they are not reservations for provider tokens, ambiguous timeout charges or all future workflows.

## Rollout and recovery classification

**Release prerequisites, not capacity work:**

1. Apply complete schema-matched migration history in the isolated environment and qualify actual Auth → PostgREST/RPC → Storage plus changed action flows. Root owns this environment. Native role GUC tests do not replace it.
2. Keep deployment holds and perform a controlled sequence: original security boundary, persisted quota/RPC migration, forward corrections (including chronology), then their dependent app callers. The new service RPC callers cannot precede its migration; old audit clients must not remain active after trusted audit enforcement without the coordinated reader/writer change.
3. Reconcile configured platform-admin emails with verified `auth.users` identities and approve owner-managed exemption entries before enforcement. No direct service exemption privilege exists. Validate active membership, roles, and revocation after the seed. The new probe rehearses owner-only configuration and removal without a chronology bypass; it is not evidence that production mappings are correct.
4. Inspect historical FK mismatches and future asset timestamps by aggregates first; retain original rows. NOT VALID constraint validation and targeted parent-state repair require an approved repair plan. No automatic historical deletion is part of the fix.
5. Measure migration lock/index duration on representative isolated data. These migrations perform ordinary index/constraint/trigger DDL inside transactions; a tiny native fixture cannot establish a safe production lock window.
6. Recovery must keep the schema protections and customer history. A blind app-only rollback can break the trusted audit/RPC/readiness contract. Use a tested corrective forward migration or coordinated compatible app version; do not drop tenant constraints or provenance to restore old behavior.

**Capacity blockers:** process-wide QBO connection budget, worker authority/deadline alignment, Sheets serial fairness/backlog/reaping, long-duration full-system soak and concurrent user targets remain unqualified. The chronology test is not a capacity result.

**Follow-up boundaries:** generic form pending/idempotency beyond the scoped form, source conflict policy, and cached-evidence/session freshness retain their earlier ledger status. Atomic memory publication is being separately handled by the security agent; this report does not qualify its new RPC. No business scoring weights, KPI semantics or historical customer data were changed by this reviewer.


## Closeout independent cross-review and rollout progress

- The latest confirmed-memory RPC was reviewed read-only: INVOKER preserves RLS, locks the file and completed source run, separates run-specific chunk identities, and retires old chunks in the same transaction as its durable receipt. The newer processing-status fence rejects approval while a newer source operation is processing. Its publication timestamp now follows lock acquisition. This review does not remove existing contributor direct-write privileges or claim every source mutation is serialized by this one RPC.
- The internal-form SECURITY DEFINER RPC was reviewed read-only: checks original authenticated identity, undeleted/unbanned user, locks active contributor membership and the current same-workspace form, checks entitlement and exact schema, and keys receipts by workspace/form/actor/request. Same-key payload conflict rejects; replay does not overwrite edited history. Direct table writes remain outside internal-workflow idempotency.
- A draft recovery trigger originally inspected only NEW.file_upload_id on UPDATE. Moving an approved row/import from unresolved source A to idle B bypassed its intended freeze. Reported immediately to security/root; security changed it to lock/check both OLD and NEW source in deterministic order and is adding both direct update tests. Final rehearsal is waiting for source-stable confirmation.

### Canonical native Supabase rehearsal

A second separately owned native Supabase 2.119 stack replayed all 123 baseline canonical migrations from 9359bb30, then the original two audit migrations and the first three closeout corrections. 25 targeted actual-SQL checks passed: interrupted DDL transaction restores original FK/catalog and every historical row; successful migration retains synthetic cross-tenant check/submission plus historical future check/parent state; composite constraints stay NOT VALID and validation correctly surfaces anomalies; new mismatches reject; platform-admin exemption requires owner setup, cannot be configured by service/authenticated API roles, retains tenant authority, and is denied after revocation; server timestamps/readiness work; deleting the foreign parent preserves mismatched child history; private schema remains unavailable to all API roles; trusted analysis RPC retains service-only admission and erases transaction authorization.

Evidence: /tmp/vaeroex-closeout-rollout-rehearsal.cjs and /tmp/vaeroex-closeout-rollout-results.json. This successful canonical run precedes the final memory processing fence and fourth closeout import-receipt migration, so it does not qualify their final state. Native version17.11/max_connections100; no production-volume locking claim or production17.6 equivalence. The second owned native service stack was stopped after evidence was saved.

### Production-shape runner correction (CL-02)

Root independently captured the hosted120-version ledger in /tmp/vaeroex-closeout-production-migration-ledger.json. The existing candidate runner's production path omitted both Sheets migrations and applied no audit migrations. The two owned runner files now apply104prefix+4Square+7QBO+2Sheets+3dashboard=120, require the captured sorted-version SHA256881b0e53e1c1a8144aba0c6ff6d895ca859cfe62544f0808df991b3959685b84, then apply the exact six shared audit/closeout migrations. Both canonical and production layouts must match their SQL hashes. The six-tail application happens after provider setup and before all suite clones; canonical no longer creates entitlement guards before later provider tables. The existing QBO-only Square catalog digest comparison is preserved before the later deliberate migration changes. Final expected counts: canonical repository129files, canonical candidate137, production candidate126.

Files: scripts/run-qbo-production-candidate-database-tests.cjs and scripts/qbo-production-candidate-runner-tests.cjs. Offline contract435assertions, scoped ESLint, node syntax and git diff whitespace checks passed. Awaiting final SQL stability for full native replay. A first attempt to put the production-shaped DB inside the already canonical-populated cluster correctly failed the original authority-role drift guard, because cluster-global provider roles had dependencies in the other database. Evidence retained as /tmp/vaeroex-closeout-production-shape-initial-isolation-failure.json. No guard was weakened; the next rehearsal will use a fresh Unix-only cluster through the existing owned-runtime helper and cached17.11 binaries.


### First full native regression run (superseded import hash)

Both shapes passed using final memory/form/chronology SQL and then-current import SQL91fe8b8606c5015b965a7f9bc0061e166ab17a35d98c862aa07e150f996a3479. Canonical:137migrations,14suites,689assertions. Exact hosted-ledger Production shape:126migrations,14suites,719assertions. Original Square catalog guard held, both clusters stopped, no provider requests. Evidence /private/tmp/qbo-candidate-evidence-e0eita/results.json and /tmp/vaeroex-closeout-full-migration-run.log. Security subsequently strengthened membership locking and current completion-timestamp reconciliation; this first pass is deliberately not final qualification of that later import SQL.

### Assembly-helper read-only review

No material fail-open issue found in scripts/workspace-closeout-local-stack.cjs: fresh direct-/tmp output, isolated CLI home/scrubbed env, migration hashes, owned local DB data_directory before explicit migration, private credential files, scoped stop after startup failure. The helper itself is only dry-run/parser qualified; do not claim actual assembly execution from that evidence. The inspected binary hash is an exported constant, while caller-supplied checksum plus version is enforced; describe that accurately. Root's separately executed local environment provides the actual runtime evidence.


## Final closeout verification (current six SQL migrations)

**Final full replay passed:** /private/tmp/qbo-candidate-evidence-F5FCas/results.json and /tmp/vaeroex-closeout-full-migration-final.log. Canonical137migrations/14suites/689assertions; exact Production126migrations/14suites/719assertions. Both clusters stopped. Captured import hashf3a127c605106d7b33c3a11d09490d39fae2c3d93d733bd205e2fda9d3ed5556; memory hashf861e70fe2e9a58599888b77263e9267ac1eae0642e153dc756f5bb3fb705288. The exact120-version hosted-ledger digest and original QBO-only Square catalog comparison passed. This is native PostgreSQL17.11 with the existing reduced platform fixture and synthetic role claims, not hosted PostgreSQL17.6/Auth token/Storage HTTP or capacity qualification.

**Final targeted Production rollout passed25/25:** /tmp/vaeroex-closeout-production-shape-results.json and /tmp/vaeroex-closeout-production-shape-final.log. Reusable harness pair: /tmp/vaeroex-closeout-production-shape.cjs and /tmp/vaeroex-closeout-rollout-rehearsal.cjs. Native path uses the existing owned-cluster helper, not an external URL or private credentials. It applies104canonicalprefix+4Square+7QBO+2Sheets+3dashboard, checks the independently captured120version digest, seeds historical mismatches/future date and synthetic admin identities, rehearses rollback of the complete first migration transaction, then applies all six final corrections unchanged. It verifies25historical, FK, entitlement, exemption/revocation, chronology, private ACL and service-admission outcomes. The original two SQL hashes are unchanged. Its cluster was stopped. Raw per-migration millisecond measurements are tiny-fixture diagnostics and provide no production migration lock-time bound.

Reproduction from the implementation worktree:

```sh
QBO_TEST_POSTGRES_BIN=/private/tmp/vaeroex-closeout-supabase-home/cache/stack/slim-services/postgres/17.11.0.002-r0/darwin-arm64/bin /Users/isaacvizcarra/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node scripts/run-qbo-production-candidate-database-tests.cjs
/Users/isaacvizcarra/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node scripts/qbo-production-candidate-runner-tests.cjs
/Users/isaacvizcarra/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node /tmp/vaeroex-closeout-production-shape.cjs
```

The saved temporary native harness resolves the existing worktree path and cached binary path explicitly; port/service targets are not accepted. It requires native shared-memory permissions, creates its own private Unix-socket-only cluster, and stops that exact cluster. The legacy optional canonical real-Supabase rehearsal entry point still requires its private local stack status file; the final production-shaped native entry point does not.

### Ready files and disposition

Owned source files ready for root staging: supabase/migrations/20261005060258_asset_check_server_chronology.sql; scripts/workspace-asset-chronology-database-tests.cjs; scripts/run-qbo-production-candidate-database-tests.cjs; scripts/qbo-production-candidate-runner-tests.cjs. Original dirty checkout untouched; no commit/branch switch/merge/deploy/production write performed. Root owns production symlinks, other manifests, final ledger and app changes.

**Release:** no remaining verified blocker found in the reviewed final form/memory/import SQL, original two migrations, or this exact-ledger runner. This qualified conclusion depends on deploying the reviewed SQL/application sequence and root's separately owned Auth/PostgREST/Storage/browser qualification. Keep operator admin-ID reconciliation and historical mismatch/future-derived readiness review as explicit release prerequisites; no history is rewritten automatically. Application-only rollback to pre-audit readers/writers is not a qualified recovery path; retain guards and use a coordinated compatible app or reviewed forward correction.

**Capacity:** still unqualified100/250/500user targets, multi-provider rate/worker soak and production-volume index/lock duration. Native17.11/max_connections20 fixture differs from deployed17.6/max_connections60.

**Follow-up:** historical constraint VALIDATE remains blocked by synthetic anomalies as intended; real anomalies need separate authorized investigation/repair. Import partial-work receipts preserve evidence and prevent automatic duplicate retry; they do not implement automatic resumption or historical cleanup. Existing direct contributor table privileges are outside internal-form/confirmed-memory cooperating RPC idempotency.


## Final runtime diagnosis boundary (2026-10-05)

The form adapter is not isolated as the cause: a direct asset-check server action reproduces the same browser completion failure. Diagnostic evidence shows actual persistence, a complete 303 RSC response, a fulfilled decoded root, and an advanced internal Next router canonical URL, while the browser URL and pending UI remain unchanged. Ten tracked WeakMap ping-cache wakeables were fulfilled. This is still a release qualification blocker, not a proven source-level application defect or an authorized reason to change calculations or navigation semantics.

Installed Next bundled React source has an important instrumentation gap: `renderRootConcurrent` in `node_modules/next/dist/compiled/react-dom/cjs/react-dom-client.production.js` around lines 11115–11128 waits on suspended reason 2/9 via `thrownValue.then(callback,callback)` directly; it does not use `attachPingListener`/WeakMap. `scheduleTaskForRootDuringMicrotask` around line11898 intentionally cancels scheduling while those reasons persist. Therefore fulfilled recorded ping-cache wakeables do not establish that every current render suspension is resolved. No further experiments or source edits were performed for this diagnosis. Evidence: `/tmp/vaeroex-navigation-suspension-review.json`, `/tmp/vaeroex-navigation-decoder-review.json`, `/tmp/vaeroex-navigation-flight-review.json`, `/tmp/vaeroex-navigation-no-interception-review.json`.

## Seventh forward migration manifest preparation

Added the exact `20261005070311_worksheet_import_publication_heads.sql` tail to eleven runner/contract files and its production symlink. Canonical exact manifest is130; complete provider replay is138 canonical and127 exact-production. Production baseline remains independently pinned120. Added the omitted-seventh negative fixture guard and preserved all prior missing-tail/unreviewed-tail guards. Offline QBO contracts435/435 and scoped ESLint pass. Architecture's final untracked-migration guard correctly rejects the new SQL until parent stages the completed source; no guard weakened. Separate seven-tail `/tmp` rollout harnesses preserve the prior six-tail evidence unchanged.


## Final seven-tail qualification results

Final SQL `20261005070311_worksheet_import_publication_heads.sql` SHA256 `56c6a11c3317bee9f1f75269b94163a399539bae0272ed5a2a4451ec0eb283ca` reviewed independently. No material authority/head-selection blocker found. The new SECURITY DEFINER read-only head function uses an empty fixed search path, explicit existing workspace membership or service role, at most200 requested IDs, and same-workspace parent matching. Private table/schema grants remain unchanged. Ordering chooses the latest completed receipt; completion replay does not re-stamp it, and active attempt admission remains serialized by source lock. Missing/unavailable/malformed head responses fail closed. Current vector matcher equals the prior202607110001 declaration exactly after removing the added completed-head predicate; the predicate occurs before rank/limit. Historical rows/citation IDs are retained; held or incomplete generation cannot replace prior committed authority.

Executed final full runner once after SQL stable: `/private/tmp/qbo-candidate-evidence-qwTBxe/results.json`, `/tmp/vaeroex-closeout-full-migration-seven.log`. Canonical138 applied migrations,14 suites,689 assertions; captured-production127 migrations,14 suites,719 assertions. Both PASS and both private native clusters stopped. Shared seven-tail hashes and the120-version production baseline digest/catalog guards held.

Executed `/tmp/vaeroex-closeout-production-shape-seven.cjs` using `/tmp/vaeroex-closeout-rollout-rehearsal-seven.cjs`: `/tmp/vaeroex-closeout-production-shape-seven-results.json`, `/tmp/vaeroex-closeout-production-shape-seven.log`. PASS25/25;120 historical +7 final corrections; historical cross-parent anomalies retained, forward invalid inserts denied, aborted DDL restores original state, exemptions require database-owner setup and remain workspace-role constrained, revocation works, private ACL intact, chronological readiness fixed. Exact same seventh hash; owned Unix-only cluster stopped. Prior six-tail evidence/harnesses remain preserved separately.

Offline: QBO runner contracts435/435; architecture guards569/569 after parent stages new SQL; scoped ESLint across all11 changed runner/contract files and git diff --check pass. The omitted-seventh negative manifest case is included alongside prior omitted/unreviewed-tail negatives. Source stable for these11files plus production symlink. No original migration edited.

Boundary: native PG17.11 with actual pgvector and synthetic platform prerequisite fixture; no production volume, production PG17.6/max60 equivalence, live rollback, authenticated browser success, or supported-user capacity claim. Independent security-agent focused receipt/head tests (58/58) additionally test current-generation vector visibility with a declared real[] distance stub, which is not a vector quality/performance benchmark. Generation retention increases stored rows; keyword scans remain bounded and realistic query cost/capacity still needs non-production load qualification.
