# Permanent broker authentication: native SCRAM + Secret Manager

## Decision and current state

Use Supabase's supported native PostgreSQL role/password authentication. Preserve
the existing broker, actual `session_user`, same-database tenant/session/member/
revocation transactions and callback flow. Do not substitute an Owner PAT,
service-role HTTP token, JIT feature or another database. Runtime operates
unattended; creation, rotation and recovery are explicit operator maintenance.
Production activation is not part of this change.

Temporary Access/JIT is **permanently parked**. The final scoped invitation
attempt returned HTTP 500 after the corrected role prerequisite; readback was
absent, not proof of acknowledged rollback. Independent cleanup verified no
rules, test role NOLOGIN with zero sessions, Temporary Access and preview off,
temporary database egress removed and exact VM stopped. The operator confirmed
the final PAT revoked. Do not request another PAT, invitation, retry or JIT VM
window. Internal cause of the provider's 500 is unknown and irrelevant to this
selected native path. Keep unchanged offline regressions as historical safety
coverage, not qualification dependencies.

## Security standard

Block reachable credential exposure, tenant escape, contract defects and
reliability failures. Do not require perfect nonrecording under every provider
failure. Plaintext credentials never enter SQL, arguments, terminal echo,
Terraform, application logs or our audit journal. libpq generates a SCRAM
verifier client-side; only that verifier enters the fixed escaped ALTER ROLE.
It is still sensitive: restricted administrators can see in-flight activity,
and exceptional server diagnostics can attach the statement. A 512-bit random
password makes offline guessing impractical; it does not make verifiers public
or excuse unrestricted diagnostic access. Restrict provider/admin access,
inventory configured exports and retention, preserve audit, and rotate/fence on
suspected exposure. No raw diagnostic payload is needed for normal support.

The managed profile observes `track_activities` rather than requiring an
unsupported SET. Other ordinary statement, parameter, debug, duration and
statistics controls must be effectively safe; readback precedes any necessary
session-only SET. Redacted pgAudit ROLE events remain. No global logging change,
log/statistics erasure, dynamic SQL wrapper or direct catalog writes are used.

Sources: [libpq password hashing](https://www.postgresql.org/docs/17/libpq-misc.html),
[Supabase native roles](https://supabase.com/docs/guides/database/postgres/roles),
[managed configuration](https://supabase.com/docs/guides/database/custom-postgres-config),
[Secret Manager least privilege](https://docs.cloud.google.com/secret-manager/docs/access-control),
[Cloud Logging routing and retention](https://docs.cloud.google.com/logging/docs/routing/overview).
Documented provider defaults are not evidence of this project's actual exports
or retention. Inspect those settings before hosted use; unknown internal copies
are an accepted provider trust boundary, not a reason for another research cycle.

## Identities, exact scope and cost

- Database: `oysjpoondtcrqpghhrbd`, `postgres`, system identifier
  `7678069749886157684`, database OID `5`; session pooler on port 5432.
- Maintenance SQL identity: existing native `postgres`, privately entered into
  an exec-owned terminal. It is a **broad maintenance administrator**, not a
  least-privilege runtime role, MFA-backed PostgreSQL authentication or automatic
  rotation. Its complete FORCE-RLS view is checked before accepting empty binding
  results. No extra provisioner SQL role or migration is required.
- Runtime role: `square_sandbox_callback_broker`, only inherited
  `square_account_broker_authority`, no admin membership, BYPASSRLS, CREATE or
  replication privileges. New role OID is recorded from native acknowledgements;
  rotation/recovery must pin the actual existing OID.
- Maintenance cloud identity: dedicated keyless
  `vx-square-sandbox-provisioner@vaeroex-square-sandbox.iam.gserviceaccount.com`.
  No key, Owner PAT or ambient ADC. Give only versions `add/access/get/disable`
  on dedicated `square-sandbox-callback-db`, using an expiring grant for the
  maintenance window. No application-secret, KMS, IAM-management or other-project
  rights. Reviewed September 9 preparation created only this service-account,
  role-definition and empty secret-container metadata. No key, secret version or
  permission binding was created; timed access remains a hosted-window step.
  The callback reader's existing permissions remain unchanged.
- Temporarily attach that identity only to the exact stopped isolated VM
  `9094944541973315575`; restore the callback identity while stopped afterward.
  Check effective inherited permissions and `cloud-platform` scope. The VM is
  one trusted administrative boundary; Unix users are not independent metadata
  credential tenants.
- No new VM, disk, IP, KMS key or paid commitment. A service account/custom IAM
  role has no fixed resource charge. One enabled Secret Manager version may add
  approximately $0.06/month outside shared free allowance; retained disabled or
  uncertain-recovery versions also count. Existing VM, retained
  disk/IP and existing KMS/secret charges remain in the approved $20/month total.
  Inspect the actual plan and current billing before hosted execution. Alerts
  are notifications, not a hard cap; preserve the approved bounded window and
  incremental admission limit. No live resource creation occurs from this code.

## Fixed lifecycle and deployment

`build-managed.mjs` explicitly compiles the immutable public Sandbox pins and a
statically linked pre-interpreter launcher on Linux. It verifies the launcher
has no dynamic interpreter or needed libraries. Ordinary builds still refuse
execution. Install reviewed files, `native-managed` and its sibling build output
as `maintenance-launcher` under root-owned `/opt/vaeroex-native-broker`; create the public binary
SHA256 file, trusted public CA at the pinned path, and an empty root-only mode0600
`/var/lib/vaeroex-native-broker/maintenance.jsonl`. Never put a password in those
files. Review artifact/dependency hashes and host recovery/security settings;
installation is manual, not a boot, CI, app build or deployment hook.

The sole supported operator entry is the fixed native
`/opt/vaeroex-native-broker/maintenance-launcher` in a private **exec-replaced**
SSH terminal, with arguments `OP ROLE_OID INTENT APPROVAL_ID DEADLINE_EPOCH_MILLISECONDS`.
All five are nonsecret. Do not invoke `node maintenance.mjs` directly: Node
startup hooks run before JavaScript checks. The static launcher ignores inherited
loader variables, validates fixed root-owned install paths, disables core dumps,
closes inherited non-stdio descriptors, and execs only `/usr/bin/node` with a
fresh PATH/LANG/LC_ALL environment. Use the existing restricted sudo/OSLogin
administrative boundary and no terminal recording. This is not protection from
an already-compromised root administrator or modified root-owned binaries.
The CLI then checks target host identity, separate metadata
service account, exact secret permission preflight, trusted CA/hash and actual
hostname-verified PostgreSQL TLS before prompting. The private prompt accepts
one line, with echo suppressed; subsequent input is discarded until exit. Do not
paste secrets into chat, commands, the database SQL editor or ordinary shells.

Native inspection then attests SQL identity, physical database, complete
authority visibility and safe effective controls **before generating any broker
credential**. Nonsecret NOLOGIN setup is separate from password assignment.
Assignment holds authority locks, sends the candidate privately to Secret
Manager, verifies CRC/readback and only then commits. Secret storage uses an
immutable version and a strict DSN codec compatible with the existing callback;
the CA remains separately configured. LOGIN activation and candidate native
authentication happen under closed application authority. Successful result is
`staged_ready`, **not** a published binding, consent, enrollment or ingestion.

An enabled stored version is not version-level IAM isolation. Runtime must use
its separately approved immutable pin, never `latest`; maintenance does not
change that pin. Only an owned version may be disabled, with checked ETag and
readback. No secret destroy operation or retention/purge selection is included.

## Rotation, interruption and recovery

Before rotation, close the actual application binding and drain service work.
The tool refuses enabled bindings. It commits NOLOGIN, drains exact-role
sessions, verifies zero sessions, assigns a fresh unique password and stages a
new immutable version. Restore runtime only after independent pin/candidate
verification. A password change alone does not revoke existing sessions.

Cancel, timeout, failed audit, lost database/store acknowledgement or abrupt
Spot interruption is not success. A fresh native lock-ordered fence reconciles
database ordering; an audit event alone never proves commit. The fsynced local
journal contains only actor, target, intent, phase, finite outcomes and version
metadata, not credentials. An interrupted journal blocks ordinary create/rotate.
Use explicit recover only after independently reconciling exact role OID and
owned secret versions. Supply root-owned mode0600 `recovery-clearance.json`
with exact prior/next intent, approval ID, project, target role/OID, confirmed
fence and zero sessions, no unresolved secret versions, and at most ten-minute
expiry. The launcher rechecks expiry after private entry. If interrupted before
role creation, a separately confirmed `roleAbsent:true` permits a new create at
OID0, still checked natively under locks. A stale exclusive invocation lock may
be removed only after confirming its recorded process no longer exists and
reconciling the interrupted run; never remove another live invocation's lock.
A lost addVersion ACK cannot be resolved by `latest`,
blind retry or assuming a nearby version is ours. Confirm ownership using scoped
provider audit metadata; if still unknown, keep authority closed and escalate
that concrete recovery issue. Never delete another version or adopt a recreated
same-name role. Preserve incomplete-run evidence.

Isaac is the current isolated maintenance/incident owner. Production needs a
named backup operator and tested private access recovery before customer use.
Record the scheduled rotation date, approval expiry and incident contact in the
operating record; manual maintenance is a supported responsibility, not a
claim of unattended rotation. Inventory actual audit buckets/sinks/access and
retention; retain sanitized operational evidence with a bounded documented
schedule, keeping credential payloads out of exports. Do not erase unrelated
audit or invent provider guarantees. Journal size is capped at1MiB and fails
closed; archive reviewed nonsecret evidence before capacity is exhausted.

## Finite remaining hosted gates

1. Finish independent review, focused changed-code tests, exact-head CI and normal
   merge/deployment verification; verify Production Square disabled/QBO unchanged.
2. Inspect the exact resource/IAM/billing plan and logging access/retention; create
   only the scoped cost-free maintenance identity/grant, keep application-secret
   access absent, and preserve callback reader permissions.
3. Install reviewed artifacts/public CA and audit journal. Check host memory,
   TLS, role/binding metadata, migration ledger and authority while gates stay
   closed. No migrations are introduced by this credential change.
4. Consolidate private native-administrator entry with the operator; no PAT.
   Qualify managed settings, native create/store/authenticate, denied unrelated
   access, fencing, session drain, rotation and recovery in the isolated target.
5. Stop/restore the VM and identity, remove temporary egress/grants, reconcile
   staged versions and document exact actual costs/outcomes. Do not claim hosted
   qualification from local tests.
6. Continue existing separately authorized Sandbox callback/consent configuration
   only with the verified immutable DB-secret pin and current authority. First
   successful consent stops at `authorized_unmapped`; no automatic seller mapping,
   enrollment, ingestion, economics or Production activation. QBO is untouched.
