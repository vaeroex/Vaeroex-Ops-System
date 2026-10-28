# Non-retryable shared-evidence identity conflict

These are the exact reviewed upgrade and rollback artifacts. Nothing in this directory applies SQL automatically.

## Installed state and source reconciliation

The retained production receipt records the forward artifact installed on project `mdiianhfrojmxqpwrflh` at **2026-10-27 18:10:14 UTC**, migration **`20261027181014`** (`shared_evidence_identity_conflict_nonretryable`). Its SHA256 is `249e8ff836f384680c954cf1197dbe076db6d2256871c6670dc6721efbeeb20b`. The verified final function-body SHA256 is `460322cb8730ac1ff72438027771b14b42a8533b0a152836f5ba0443205e82a3`; function OID `38287`, all 19 captured function attributes and the owner-only ACL were unchanged. No source or saved-answer data was rewritten. The application remained `5ca06d3a7417c30e5bdbff9e731fb724b601e8cb`, with all three VSI switches OFF.

This source-controlled reconciliation does **not** require another hosted SQL operation. The forward and rollback bytes, historical draft 06 and original preparation manifest are preserved. In that manifest, `local_review_only_not_applied` and `actualPostgrest14ExecutionProved:false` describe the original offline preparation, not the later production state. The retained installation receipt separately records three existing backend requests emitting PT409 after the update and ending without manual cancellation; it is not proof about every other custom-error path.

For **new installations only**, `scripts/shared-evidence-release-package.cjs` now includes this exact forward artifact as its final source, after draft 10's function rename. The assembler pins its digest, enforces ordering and requires the complete guarded replacement to be the last step before the bootstrap transaction commits. The SQL itself verifies the prior body/security state and the final PT409 body/security state. Therefore a new bootstrap cannot finish with this particular identity rejection still using `40001`. Other intentional `40001` branches are unchanged. The bootstrap is not an upgrade script for the existing production database and is never applied by the assembler or application.

## Evidence and exact change

The retained production log interval, 2026-10-27 15:34–16:34 UTC, contains 3,584 SQLSTATE `40001` errors whose first context function is `private.shared_evidence_before_memory_receipts_v1`. The observed access path is PostgREST 14.5. The repository defines this function in draft 06 and renames it in draft 10. Its own `40001` branch rejects an immutable identity that differs from the resolved identity.

[Supabase documents a PostgREST 14 infinite-retry bug](https://supabase.com/kb/troubleshooting/high-cpu-and-infinite-transaction-retries-when-using-custom-error-codes-in-rpc-functions) for custom `40001` RPC exceptions. The observed stream and code match that mechanism. The original public RPC/actor, current looping backend identities and exact share of CPU remain unproven. This patch does not claim to establish them.

`forward.sql` changes **only that function's exception code** from `40001` to `PT409`. Its comparison, message `shared_typed_identity_changed`, return paths and rejection behavior are unchanged. `PT409` returns an HTTP 409 conflict without presenting a deterministic integrity rejection as a serialization retry. No data, saved answer, source hash, identity, session, owner check, RLS policy or privilege is modified.

The generated manifest contains exact body and artifact SHA256 digests. Before and after replacement, SQL checks the body hash, signature, owner, language, return type, defaults, argument names, security-definer/volatility/strictness/leakproof/parallel attributes, cost, support function, empty search path and owner-only execution ACL. Missing or unexpected baseline aborts the transaction. CREATE OR REPLACE preserves function identity and grants. No bootstrap SQL is replayed.

## Application compatibility and scope

The existing generation RPC helper and saved-evidence reader reject any RPC error without an application retry. The exact unchanged error message still classifies as `stale_binding`. Their current diagnostic SQLSTATE allowlist records `PT409` as null, while retaining HTTP 409 and the safe reason. That minor visibility limit does not require an application change or deployment to preserve rejection. Caller tests verify this behavior and raw-detail redaction.

Other deliberate `40001` branches remain in typed preview, approved-memory certification/wrappers, legacy resolution, final manifest validation, workspace fencing and reopened-artifact hash checks. They are not silently changed here. This correction addresses the observed inner function; it is not a claim that every future custom 40001 path is safe. Native PostgreSQL serialization errors are untouched.

## Installation prerequisites and stopping points

The production installation above is complete. Do not replay this artifact or the bootstrap for an application release. Any separately proposed application to an unpatched installation requires explicit approval of its exact target, forward digest and these actions:

1. Verify the live release remains gates OFF, retained recovery definitions/backup remain available, and the function body/security baseline matches the manifest. Baseline hashes derive from the reviewed installation source; the retained receipt is historical evidence, not a fresh check of another target. Stop on drift, an already-patched body or denied/uncertain access.
2. Exclude concurrent schema edits for the short maintenance operation. The pre/post guards are not a lock against noncooperating concurrent DDL. Apply forward once in its atomic transaction, preserving the 5-second lock and 120-second statement timeouts. On uncertain outcome, inspect metadata before any retry.
3. Verify the new body hash and unchanged OID/security/ACL; do not invoke production evidence RPCs just to manufacture a failure. No activation, model/provider calls, imports or source writes are needed.
4. Separately identify any still-looping backend from fresh error/active-session metadata. Existing retries may survive a function update. Clearing them requires specific approval and rechecking backend identity/start time/function before acting. Do not terminate every authenticator connection, cancel unrelated work or restart the project.
5. After an approved correction/cleanup, use a bounded CPU/error observation to establish effect. Do not claim recovery from SQL installation alone.

This reconciliation includes no cancellation, restart, compute change, schedule change, credential operation or hosted inspection. Activation gates remain OFF. It adds no model/API spending.

## Recovery

`rollback.sql` is an exact, guarded definition reversal, not an automatic recovery action. It requires the patched body/security baseline and restores only the prior definition. It **reintroduces the known retryable 40001 hazard** and does not clear in-flight retries. Prefer a reviewed forward correction when possible. Any rollback decision and any live-session cleanup require separate approval. There is no data restore, table rewrite, permission change or saved-answer repair in either artifact.

## Local verification and limits

Run assembly checks and the focused caller tests without credentials:

```sh
node scripts/shared-evidence-identity-conflict-upgrade.cjs --check
node scripts/shared-evidence-identity-conflict-caller-tests.cjs
node scripts/shared-evidence-release-package.cjs --check
node --test scripts/shared-evidence-release-identity-tests.mjs
```

The bootstrap-tail regression is self-contained and uses no private captures. It executes the exact historical wrapper, rename and assembled PT409 tail in disposable PGlite with explicitly synthetic resolver dependencies. It verifies final body/security state, valid return, non-retryable changed-identity rejection without successful writes, unauthorized direct execution and transactional failure on drift. It does not claim full bootstrap-schema installation or real platform authorization parity.

The isolated SQL suite reuses existing screened private fixture captures outside Git:

```sh
SHARED_EVIDENCE_PRIVATE_FIXTURE_DIR=/absolute/path/to/existing/screened/captures node --test scripts/shared-evidence-identity-conflict-upgrade-tests.mjs
```

These execute actual PostgreSQL semantics through PGlite and actual application error handlers with mocked transport. They do not run an actual PostgREST 14 server, reproduce production CPU, prove that old transactions stopped, or prove hosted all twelve answer quality. No private captures, credentials or source records are included in this candidate.
