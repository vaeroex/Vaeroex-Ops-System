# Nonsecret isolated JIT role fixture

The user approved isolated execution on 2026-09-08. The rendered setup transaction
has created only the NOLOGIN fixture in `oysjpoondtcrqpghhrbd`, database `postgres`,
with role OID `25104`; independent readback confirmed no memberships, zero sessions
and two FORCE-RLS tables. Activation, JIT grant and real PAT phases remain gated;
see [QUALIFICATION.md](QUALIFICATION.md) for the sanitized evidence. These scripts contain no credential
assignment, token issuance, application migration or Square capability grant.

`setup.sql` creates exactly one NOLOGIN role and a private two-table fixture. It
aborts rather than adopting any preexisting exact role/schema. `rows` contains
two synthetic workspace markers; the SELECT policy requires both actual
`session_user` and the fixed allowed UUID. It does not trust a user-settable GUC.
Both tables have ENABLE/FORCE RLS; no policy is granted on `denied`. The test role
has SELECT only on `rows`, no capability membership, and no privileged attributes.
The read-only role default is defense in depth, not authorization: the runner
switches a transaction to READ WRITE to verify that grants independently deny writes.

Every script requires the independently verified `expected_system_id` and
`expected_database_oid` as nonsecret psql variables. `activate.sql` and `fence.sql`
also require `expected_role_oid`, captured from the committed setup result and
independently re-read before activation. `psql -X --set ON_ERROR_STOP=1` is the
local synthetic harness transport, not an assumption that a hosted native
administrative credential exists.

The proposed hosted transport is the existing Owner dashboard SQL editor for
nonsecret statements only. `render-dashboard.py` accepts only `setup`, `activate`,
`fence-commit` or `drain` and strictly decimal physical/database/role pins. It
inlines the fixed gate and emits fixed SQL without psql meta-commands; it cannot
take arbitrary SQL, a source path, credentials or a connection. Run each emitted
block as a separate dashboard request. Confirm the committed NOLOGIN state
before submitting `drain`; the latter independently rechecks physical identity
and sets the role pin in its own transaction. There is no cross-request session
affinity assumption. No Owner PAT, platform-token substitution or native admin
password is used in the test runner. Hosted dashboard native operator identity,
permissions and physical-control visibility are gates still to confirm; a
`session_user`/`current_user` mismatch must stop, not be bypassed. The SQL editor
may save this intentionally nonsecret fixture SQL; never put a PAT in it.

The identity gate checks primary PG17, database, physical system identifier, and
unmodified native operator identity before DDL. It does not itself prove TLS,
JIT scope, project API identity, or safe connection credential delivery. Those
are mandatory separate execution gates. Do not bypass a gate to accommodate a
pooler. A cooperating advisory lock serializes these scripts, but the operator
must also exclude concurrent administrative role replacement/grant changes.

Activation does not trust RLS state from the separately committed setup. It
begins READ COMMITTED before target inspection, verifies that effective isolation,
and takes ACCESS SHARE NOWAIT locks on both fixture tables through LOGIN/COMMIT.
It rechecks ENABLE/FORCE RLS on both ordinary tables and exactly one SELECT,
permissive policy: the pinned role alone, native `SESSION_USER` plus the fixed
workspace UUID, no WITH CHECK and no extra policy on either table. Deparsing uses
transaction-local `search_path=pg_catalog`. Drift or lock contention rejects while
the role stays NOLOGIN; no hosted policy is silently repaired. PostgreSQL17.6
[policy DDL](https://github.com/postgres/postgres/blob/REL_17_6/src/backend/commands/policy.c)
and [RLS flag DDL](https://github.com/postgres/postgres/blob/REL_17_6/src/backend/commands/tablecmds.c)
take conflicting AccessExclusive locks. These locks protect this interval, not
later privileged changes or unrelated role grants; operator exclusivity remains
required. Local regressions cover flag/policy drift, DDL contention, inherited
snapshot isolation, rollback and clean activation. A hash-verified original-code
counterfactual reproduces both-workspace exposure for disabled RLS, `USING(true)`
and an extra permissive policy, then fences the local test role.

`activate.sql` is a distinct future action. It rejects unexpected reachable
user-schema relations, sequences, schema CREATE privileges, and SECURITY DEFINER
functions, with one narrow supported exception: the separately reviewed
`public.rls_auto_enable()` must be a zero-argument, scalar `event_trigger` return,
PL/pgSQL definer with exactly `search_path=pg_catalog`, and exactly one enabled
`ddl_command_end` binding whose tags are CREATE TABLE, CREATE TABLE AS and SELECT
INTO. Missing/NULL configuration, additional bindings or an ordinary-return
same-name function still blocks. No other event-trigger or SECURITY DEFINER
function is exempted. It does not remove project-wide PUBLIC privileges. An inherited grant
failure is an observed feasibility blocker requiring review, not authorization
for global REVOKE. PostgreSQL catalog visibility and existing PUBLIC database
CONNECT/TEMP privileges remain; NOINHERIT does not remove PUBLIC. Native/JIT
database reach must be qualified rather than claiming literal zero metadata or
temporary-object capability. No existing caller permissions are changed.

The exception distinguishes EXECUTE ACL metadata from actual callability.
PostgreSQL 17's PL/pgSQL compiler rejects an ordinary SQL call returning
`event_trigger` with SQLSTATE `0A000` before executing the body. The local test
installs a first-statement `P0001` sentinel and proves an actual native ordinary
test-role SELECT receives `0A000`, not the sentinel. EXECUTE and PUBLIC ACLs are
unchanged across activation. This is not a claim that the event hook never runs:
DDL triggers still run for their events, including relevant temporary DDL. The
actual hosted hook body was separately inspected as restricting RLS enablement
to schema `public` and logging nonsecret object identity. The test role has no
schema CREATE in `public`, and no credentials enter DDL/SQL. Exclude concurrent
administrative changes and recheck the current body/binding before activation;
this guard does not attest a provider binary or authorize changing its function.
Sources: [event-trigger behavior](https://www.postgresql.org/docs/17/event-trigger-definition.html)
and [PG17.6 PL/pgSQL return-type check](https://github.com/postgres/postgres/blob/REL_17_6/src/pl/plpgsql/src/pl_comp.c).

Cleanup order: revoke the exact JIT grant and PAT through the private provider
flow; execute `fence.sql` using the pinned OID; confirm the committed NOLOGIN
fence, fresh target-session count zero, and rejected reconnection. The fence is
committed before draining. Drain targets exact role OID/name and freshly checked
PID/start-time metadata, bounded to at most eight sessions and three passes;
unconfirmed termination fails. PostgreSQL signalling is PID-based, so this is a
race-aware operational drain, not a claimed atomic PID-generation API. Repeated
fencing is safe; failures leave a committed fence where obtained. Do not infer
cleanup success from a command being sent. Leave the fixture fenced for evidence;
no DROP, unrelated session termination, log deletion, or token in SQL is included.

Run `python3 -S tools/jit-access-feasibility/verify-fixture.py --pg-prefix /absolute/path/to/postgresql-17.6` for the bounded local
fixture qualification. It accepts no remote target, runs fresh PostgreSQL 17.6
with no TCP listener and a run-owned 0700 UNIX socket, accepts no credential, and
stops its cluster in `finally`. It covers identity/OID failures, duplicate setup,
PUBLIC privilege rejection, the exact uncallable event-trigger shape, wrong
return/configuration/binding rejection with unchanged PUBLIC ACL, actual native
role identity, RLS, grant denials,
reconnection, connection limit, and exact-session drain without killing an admin
observer. It does not validate Supabase JIT authentication, hosted logging, or
grant/token expiry. Synthetic server artifacts remain only in the identified
local run directory; no existing project data is read or modified.
Add `--dashboard` to execute the rendered SQL, with
fence and drain in different local administrative sessions. This validates SQL
equivalence and fresh-session pins, not the hosted SQL editor's permissions.
