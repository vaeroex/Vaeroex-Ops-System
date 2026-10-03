# Fixed native provisioning: evidence and policy boundary

## Current policy — September 9, 2026

The user explicitly replaced the absolute diagnostic-nonrecording requirement
with practical production-grade controls. [MANAGED-SCRAM.md](MANAGED-SCRAM.md)
is authoritative for the new managed lane. The analysis below is retained as
historical evidence, **not an outstanding PANIC-policy approval gate**.

The managed lane prohibits plaintext credentials in SQL, arguments, files,
application logs and ordinary statement/statistics capture. It uses supported
client-side SCRAM hashing, encrypted private secret storage, separate maintenance
and runtime identities, tenant/transaction fencing and useful sanitized audits.
Privileged activity inspection and exceptional provider diagnostics can expose a
SCRAM verifier; this is explicitly documented administrative attack surface,
not plaintext and not a zero-recording promise. Access restriction, retention
inventory and incident recovery replace theoretical perfect-nonrecording tests.

## Historical evidence under the previous policy

Reviewed baseline: `bef41579bc86baa4c71bf43b5a22c5b2e857cb06`.
This report supersedes the inference that arbitrary parameter-conversion or
dynamic-SQL errors automatically disqualify a constrained native operation.
It does not retract those reproductions or the prohibition on known sensitive
diagnostic recording. No hosted credential assignment was performed.

## Evidence classes

| Evidence | What it establishes | What it does not establish |
| --- | --- | --- |
| Earlier local restricted tests: three successes and missing-role failure | Ordinary logs/statistics can exclude synthetic password/verifier payload while retaining role audit | Every failure path, the final native implementation or hosted behavior |
| Prior read-only hosted settings | PG 17.6, pg_stat_statements 1.11, pgAudit 17.1 preload, ordinary statement/statistics capture enabled | Capture of any actual broker credential, complete Supautils allowlist, binary identity or provider internal diagnostics |
| This native/local suite | The actual fixed libpq operation, controls and tested lifecycle under the pinned local build | Hosted qualification, production activation or zero recording under all hardware failures |
| Source-established PANIC path | A verifier-bearing in-statement storage failure can reach statement logging | Frequency, occurrence on this host, or a reproduced disk failure |
| Remaining hosted evidence | Provider/hook/permission/logging and session behavior must be attested | Permission to treat an inaccessible surface as harmless |

The prior privacy review and production authentication design were inspected.
They remain historical evidence; **SU-467250 is now pending**. No completed
experiment is repeated merely to wait for support. New cases target the actual
worker, effective SET behavior, cancellation/acknowledgement and concrete
diagnostic surfaces.

## Supported native operation

[PostgreSQL's libpq contract](https://www.postgresql.org/docs/17/libpq-misc.html#LIBPQ-PQCHANGEPASSWORD)
documents client-side password hashing followed by an ALTER command.
The [17.6 implementation](https://github.com/postgres/postgres/blob/REL_17_6/src/interfaces/libpq/fe-auth.c#L1401)
quotes the role and constructs that fixed command. Cleartext is not the SQL
payload, but a SCRAM verifier **is**. Parameterization is not claimed to eliminate
recording, and the implementation does not use dynamic functions or catalog
write shortcuts.

[Supabase role guidance](https://supabase.com/docs/guides/database/postgres/roles)
supports separate native service roles. It does not promise that their password
DDL is excluded from all logging. The existing broker depends on the native
authenticated role, so replacing it with a service-role HTTP token would remove
an existing authority boundary and is not part of this design.

## Surface-by-surface analysis

### Ordinary statement, duration, error and parse logging

The provisioning session sets and reads back statement logging `none`, error
statement threshold `panic`, both parameter lengths `0`, all duration/sample
capture off, and debug parse/rewrite/plan output off. It never changes global
settings or suppresses unrelated sessions' audit/errors. Necessary error records
remain; the tool does not copy their raw contents into its own diagnostics.

The [logging contract](https://www.postgresql.org/docs/17/runtime-config-logging.html)
separates error messages from attached statements. `panic` is a threshold, **not
an off switch**. [Query dispatch](https://github.com/postgres/postgres/blob/REL_17_6/src/backend/tcop/postgres.c#L1031)
retains the current command in `debug_query_string`. USERSET debug parse/rewrite
logging is independently disabled: a utility parse tree can contain password
options even when normal statement logging is off.

### pg_stat_statements and query-text files

`pg_stat_statements.track=none` is verified before password generation. The
[pinned extension implementation](https://github.com/postgres/postgres/blob/REL_17_6/contrib/pg_stat_statements/pg_stat_statements.c#L829)
checks tracking before recording relevant parse/utility text. `save=off` alone
would not prevent the running query-text file; this tool does not rely on it.
Qualification scans live statistics, the running text file and stopped saved
statistics. Unsafe positive controls and protected operations use separate
fresh clusters; no reset/deletion makes the protected result appear clean.

### Audit preservation

The session retains pgAudit ROLE logging with statements enabled and parameter
logging disabled. [pgAudit 17.1's redactor](https://github.com/pgaudit/pgaudit/blob/538f89a93d8fd0d8913f3d740cacaea7b7eb66d9/pgaudit.c#L612)
masks the canonical password clause. It finds the first case-insensitive
`password` substring, hence the target-name restriction. It does not sanitize
unrelated core log entries.

The [utility hook](https://github.com/pgaudit/pgaudit/blob/538f89a93d8fd0d8913f3d740cacaea7b7eb66d9/pgaudit.c#L1688)
emits a successful role event before outer transaction commit; a later rollback
or lost acknowledgement still matters. Failed commands need the supervisor's
sanitized intent/outcome events. Audit contains actor, exact target, operation,
time, correlation and finite outcome, never passwords, verifiers, SQL text,
secret digests or raw exceptions. An audit entry is not a commit certificate.

### Effective permissions and hooks

[Pinned Supautils](https://github.com/supabase/supautils/blob/e35f8affc4467202ff0d98f8dd14cb955bc13c75/src/supautils.c#L1021)
intercepts SET statements and can permit configured settings despite a false
native parameter-ACL check. The tool performs fixed SET plus readback, not a
`set_config` assumption. Missing permission fails before generating a candidate.
Hosted allowlists must include all SUSET controls actually used, particularly
activity and lock logging. Supautils can temporarily elevate a permitted ALTER;
auditing must retain authenticated `session_user` rather than treating transient
`current_user` as the operator identity.

The physical identity function uses ordinary SQL EXECUTE ACLs. Its
[upstream implementation](https://github.com/postgres/postgres/blob/REL_17_6/src/backend/utils/misc/pg_controldata.c#L32)
does not justify adding a broad administrator/monitoring role. If a hosted ACL
denies identity verification, stop and resolve the scoped supported design.
Unknown password/object hooks, preload instrumentation and session pool reset
behavior are unqualified, not presumed safe. Direct dedicated sessions are the
intended transport; transaction pooling cannot establish session-wide controls.

### Activity, deadlocks, concurrency and tracing

`track_activities=off` is verified before generation. The
[activity implementation](https://github.com/postgres/postgres/blob/REL_17_6/src/backend/utils/activity/backend_status.c#L503)
clears the shared activity string on the next report. This protects activity
sampling, crashed-backend activity lookup and a different session's deadlock
report. It does not clear `debug_query_string` or disable static tracing probes.
Configured query tracing or external memory capture is a separate hosted gate.

[Deadlock diagnostics](https://github.com/postgres/postgres/blob/REL_17_6/src/backend/storage/lmgr/deadlock.c#L1072)
can fetch another participant's activity and attach it to log detail. CSV can
retain that detail even with terse text verbosity. Therefore neither terse
formatting nor `log_lock_waits=off` replaces activity suppression.

The target is already committed NOLOGIN before assignment. A nonsecret ALTER
inside the assignment transaction acquires its tuple before generation; the
subsequent fixed password update sees the transaction's own tuple version and
retains the relation lock until commit. [Role update](https://github.com/postgres/postgres/blob/REL_17_6/src/backend/commands/user.c#L988),
[heap self-lock handling](https://github.com/postgres/postgres/blob/REL_17_6/src/backend/access/heap/heapam.c#L3558).
The preceding SHARE/advisory/tuple lock waits contain no credential payload.
An uncommitted NOLOGIN alone would not fence concurrent authentication; a
separate committed fence and session drain are mandatory.

This is not a proof of zero waits/deadlocks. Catalog index locks can be reopened,
cache misses take new relation locks, and privileged catalog operations or hooks
can affect the graph. A simple pair of concurrent same-role updates is not by
itself a demonstrated cycle. The bounded worker and activity suppression remain
necessary even after early locking. No ordinary deadlock cycle under the exact
final profile is claimed without a reproducing test; source-supported hostile
administrative scenarios are labeled separately.

### PANIC: a known unresolved path, not generic uncertainty

The source chain is canonical ALTER → CatalogTupleUpdate → heap update critical
section → WAL insertion/buffer advance → WAL write. A write failure can raise
PANIC **during the verifier-bearing statement**, not only at COMMIT.
[Heap/WAL insertion](https://github.com/postgres/postgres/blob/REL_17_6/src/backend/access/heap/heapam.c#L4092),
[WAL writer](https://github.com/postgres/postgres/blob/REL_17_6/src/backend/access/transam/xlog.c#L2457),
[statement attachment](https://github.com/postgres/postgres/blob/REL_17_6/src/backend/utils/error/elog.c#L2728).
This path was source-verified; the qualification does not claim to have caused a
disk failure. An explicit transaction and separate COMMIT reduce other exposure
windows but do not eliminate it. There is no stock `log_min_error_statement=off`.

### Client memory, transport and intended storage

Transient native/libpq/TLS/server memory necessarily holds authentication
material. Private pipes avoid command arguments, shell history and ordinary
files. TLS protects network transport; local sockets are confined to a private
fixture. No libpq tracing is enabled, raw errors are discarded at the application
boundary, and the worker disables owned core/dump paths. Host swap, dump tools,
debuggers, profilers, packet instrumentation and provider hooks require separate
hosted evidence. Owned-buffer wiping is not a claim of complete heap erasure.

SCRAM authentication necessarily stores a verifier in PostgreSQL's authorized
authentication catalog and its database durability/backup surfaces. The approved
encrypted credential store holds the client secret. These are intended
authentication storage, not permission to put either value in ad-hoc files,
logs, telemetry, Terraform state or query statistics. If policy forbids even
native authentication-catalog durability, native SCRAM cannot satisfy it; that
would require a separate explicit policy/architecture decision, not this tool.

## Unchanged-policy conclusion

**No-go for real credential assignment under the unchanged absolute policy.**
The code safely enforces this with an unconditional release gate. A green local
suite establishes the tested ordinary paths, not the absence of the known PANIC
path or unqualified hosted capture. No database migration or privileged wrapper
is proposed to hide that conclusion.

Two possible resolutions remain: (a) a supported provider mechanism that removes
the verifier **before initial diagnostic persistence**, with independent
qualification, or (b) the following narrow permanent policy refinement. Neither
is approved or implemented by this PR. Log exclusions, delayed deletion, a
generic support assurance and previous acceptance of inaccessible diagnostics
are not substitutes for (a).

## Exact proposed refinement — requires the user's decision

> For the approved fixed native PostgreSQL broker password-assignment operation
> only, permit a SCRAM verifier, but never the cleartext password, to appear in
> provider-controlled core PostgreSQL PANIC diagnostics caused by an in-statement
> database/storage failure when documented session controls cannot prevent that
> attachment. This exception does not permit ordinary statement/error/statistics
> capture, activity sampling, debug/trace output, client/application logging,
> monitoring payloads, or unreviewed extension and crash-dump capture. Such a
> diagnostic is restricted security-incident material: access and retention must
> be explicitly approved and controlled; any affected broker remains fenced
> until the recording path is understood and a fresh credential is safely
> established. Sanitized actor/target/operation/outcome auditing must remain.
> No automatic log deletion, suppression of unrelated auditing, or inference of
> commit success from an audit record is authorized.

Affected surfaces would be PostgreSQL text/CSV/JSON core PANIC records and any
provider collector, export, backup or incident workflow retaining those records.
The verifier is security-sensitive and permits offline password guessing;
512-bit unique random credentials make guessing unrealistic but do not make
retention compliant under the present policy. Accidental export, compromised
diagnostic access and delayed discovery remain risks. Approval must specify
diagnostic access/retention, incident ownership and recovery controls; this report
chooses no retention value. It does not authorize known tracing/deadlock/activity
leaks. Without either resolution, remain blocked on real provisioning while
continuing authorized local implementation and review.
