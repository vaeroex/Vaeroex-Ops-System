# Managed SCRAM review and evidence

Base: `2bf488a40c0e49712052421a5e4e401dc34cab8d`. Scope is the native
maintenance tooling, its focused tests, CI registration and decision records.
No application, QBO, migration, provider registry or runtime binding code changes.

## Independent review

Separate reviewers inspected the native managed profile/SCRAM operation,
complete FORCE-RLS visibility, candidate authentication, private adapter,
immutable Secret Manager staging, DSN codec, metadata identity, protected entry
and maintenance cancellation/recovery/locking. Authors did not self-certify the
combined implementation. Root performed integration review.

Concrete findings corrected before delivery:

- Administrator FD3 must also be supplied during candidate FD6 authentication;
  the native worker retains its administrator authority locks for that step.
- Child completion cannot outrun administrator acknowledgement; private supplier
  cancellation is tied to the individual child operation.
- Secret Manager paths are fully anchored and disable preserves the ETag
  concurrency precondition. Uncertain add acknowledgement never permits guessing
  ownership or blind retry.
- The DSN preserves the existing callback's `sslmode`-only URL contract; public
  CA configuration remains separate rather than widening runtime parsing.
- Private entry responds to cancellation and keeps late input in a no-echo
  discard sink until process exit. Single-line private paste is supported.
- A hard deadline, cleanup reserve, exclusive invocation lock and exact
  short-lived recovery clearance preserve cross-process ordering. Clearance is
  rechecked after private entry; an interrupted absent-role create needs its own
  explicit absence reconciliation. Validated nonsecret role OID is journaled.

No remaining material finding in the completed targeted reviews. Later changes
require review of their affected boundary, not a repeat of unrelated audits.

## Local evidence (not hosted qualification)

- 241 Node regressions passed across lifecycle, private adapter, staging, codec,
  fixed REST transport, metadata identity, entry and maintenance policy.
- 167 strict native PostgreSQL17.6 fixture assertions passed; cluster stopped.
- 55 managed native fixture checks passed, including actual SCRAM auth/rotation,
  NOLOGIN+session drain, private delivery/readback, uncertain acknowledgement,
  fresh replacement, rejected filtered FORCE-RLS visibility, safe effective
  controls and preserved redacted pgAudit. Later test-only client-version probe
  is included in CI against both17.6 and16.15; no hosted-success inference.
- Actual Mac PTY: five synthetic cases passed (paste, timeout, Ctrl-C, signal,
  non-TTY); no echo, late-input wiping and terminal restoration verified. Linux
  runs the same test in CI.
- Typecheck passed; repository lint passed with59 existing warnings and no new
  warnings. Focused changed-file lint and `git diff --check` passed.

The fixture reproduced privileged `pg_stat_activity` visibility of a SCRAM
verifier, reported as a boolean only. It also verified absence of plaintext and
verifier payload in the tested ordinary logs/statistics while redacted role
auditing remained. This is measured local evidence, not zero-recording proof.

Exact-head GitHub checks, actual Linux16.15 qualification and automatic
deployment verification are recorded in the PR/check runs. No test in this
delivery uses a hosted credential or starts the Sandbox VM.

The first Linux CI run passed168 strict native assertions but exposed a glibc
feature-macro redefinition in the included managed-profile test translation
unit. The macro now consistently uses value1; an explicit normalized-macro
compile regression and12 profile observations pass locally. Fixed finite build
substage labels distinguish subsequent compiler boundaries without printing raw
errors. The corrected Linux CI result remains the delivery gate.

## Hosted preparation status

Read-only recheck: exact VM `9094944541973315575` remains TERMINATED. The planned
`square-sandbox-callback-db` secret container is not yet present. Creating its
metadata and the separate scoped maintenance service identity, installing public
artifacts, private native administrator entry and actual hosted qualification
remain distinct steps under the standing Sandbox authorization. No new database
migration, JIT/PAT, application-secret read, live Square call or Production
activation is introduced by merging this code.
